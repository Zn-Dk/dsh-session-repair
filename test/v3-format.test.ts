import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { DIAGNOSTIC } from '../src/protocol.js'
import { validateEvents } from '../src/doctor-core.js'

/**
 * V3 format-admission detection, mirroring the installed engine's actual rules.
 *
 * Scope note (learned the hard way): the engine validates `message.source.kind`
 * against a closed vocabulary, but validates source FIELD names only on the
 * `agent-message` branch. An earlier revision of this plugin asserted a wider
 * field vocabulary and reported lawful `form`/`provider` keys as defects across
 * a real session. These tests pin the narrow, correct scope.
 */

const SESSION_ID = '50315286-4e40-4aa0-bde7-284934e7cf7b'

/** A stored artifact in the real on-disk shape: header fields at the top level. */
function header() {
  return { type: 'session', version: 0, id: SESSION_ID, createdAt: 1, cwd: '/w', delegationDepth: 0 }
}

function healthyEvents() {
  return [
    header(),
    { type: 'user/message', seq: 0, time: 2, data: { id: 'm1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] } },
  ]
}

function codesFor(events) {
  return validateEvents(events, SESSION_ID).checks.map(c => c.code)
}

describe('V3 format admission', () => {
  it('accepts a healthy current artifact (header version 0 is the physical generation)', () => {
    const report = validateEvents(healthyEvents(), SESSION_ID)
    assert.deepEqual(report.checks, [])
    assert.equal(report.severity, 'healthy')
  })

  it('reports a source kind outside the audited vocabulary', () => {
    const events = healthyEvents()
    events[1].data.source = { kind: 'plugin:dsh-mnemon' }
    const report = validateEvents(events, SESSION_ID)
    const hit = report.checks.find(c => c.code === DIAGNOSTIC.SOURCE_KIND_UNCLASSIFIED)
    assert.ok(hit, 'expected source-kind-unclassified, got ' + codesFor(events).join(','))
    assert.equal(hit.severity, 'blocked')
    assert.equal(report.severity, 'blocked')
  })

  it('admits every lawful source kind, including one with extra attribution fields', () => {
    for (const kind of ['user', 'plugin', 'model', 'tool', 'agent-instructions', 'agent-message', 'skill-catalog']) {
      const events = healthyEvents()
      events[1].data.source = { kind, form: 'notice', provider: 'x', summary: 'y' }
      const codes = codesFor(events)
      const unexpected = codes.filter(c => c === DIAGNOSTIC.SOURCE_KIND_UNCLASSIFIED)
      assert.deepEqual(unexpected, [], 'kind "' + kind + '" must be admitted')
    }
  })

  it('reports an agent-message source field outside its closed shape', () => {
    const events = healthyEvents()
    events[1].data.source = { kind: 'agent-message', form: 'relay', senderSessionId: 's2', stray: true }
    const codes = codesFor(events)
    assert.ok(codes.includes(DIAGNOSTIC.SOURCE_FIELD_UNEXPECTED), 'expected source-field-unexpected, got ' + codes.join(','))
  })

  it('leaves a lawful agent-message source alone', () => {
    const events = healthyEvents()
    events[1].data.source = { kind: 'agent-message', form: 'relay', senderSessionId: 's2' }
    assert.deepEqual(codesFor(events), [])
  })

  it('reports a null usage token count as repairable', () => {
    const events = healthyEvents()
    events.push({ type: 'assistant/message', seq: 1, time: 3, data: { id: 'm2', role: 'assistant', source: { kind: 'model' }, content: [], usage: { inputTokens: null, outputTokens: 5 } } })
    const report = validateEvents(events, SESSION_ID)
    const hit = report.checks.find(c => c.code === DIAGNOSTIC.USAGE_NULL_TOKEN)
    assert.ok(hit, 'expected usage-null-token, got ' + codesFor(events).join(','))
    assert.equal(hit.severity, 'repairable')
    assert.equal(report.severity, 'repairable')
  })

  it('treats a negative or unsafe token count as blocked', () => {
    const events = healthyEvents()
    events.push({ type: 'assistant/message', seq: 1, time: 3, data: { id: 'm2', role: 'assistant', source: { kind: 'model' }, content: [], usage: { inputTokens: -3 } } })
    const report = validateEvents(events, SESSION_ID)
    const hit = report.checks.find(c => c.code === DIAGNOSTIC.USAGE_NULL_TOKEN)
    assert.ok(hit)
    assert.equal(hit.severity, 'blocked')
  })

  it('does not flag a gappy seq stream: density binds migration inputs, not stored artifacts', () => {
    // Real subagent sessions carry large seq jumps and load fine; a gap here is
    // informational at most and must never raise severity.
    const events = healthyEvents()
    events.push({ type: 'sandbox/mode', seq: 900, time: 4, data: {} })
    const report = validateEvents(events, SESSION_ID)
    const gaps = report.checks.filter(c => c.code === DIAGNOSTIC.SEQ_GAP)
    assert.equal(gaps.length, 1, 'gaps collapse into one aggregated check')
    assert.equal(gaps[0].severity, 'info', 'a gap stays informational')
    assert.equal(gaps[0].details.gapCount, 1)
    assert.equal(report.severity, 'healthy')
  })

  it('counts every gap in one aggregated check rather than one row per jump', () => {
    const events = healthyEvents()
    events.push({ type: 'sandbox/mode', seq: 500, time: 4, data: {} })
    events.push({ type: 'approval/policy', seq: 900, time: 5, data: {} })
    const gaps = validateEvents(events, SESSION_ID).checks.filter(c => c.code === DIAGNOSTIC.SEQ_GAP)
    assert.equal(gaps.length, 1)
    assert.equal(gaps[0].details.gapCount, 2)
  })
})
