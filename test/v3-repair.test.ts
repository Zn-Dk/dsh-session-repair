import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { applyFormatRepair, findFormatRepairs } from '../src/repair.js'

/**
 * V3 format repairs. Two properties matter:
 *
 * 1. Scope discipline — a plan names one exact event type, so a repair can never
 *    touch an unrelated event that happens to carry a same-named key. An earlier
 *    revision rewrote a key across all event types and corrupted 285 sessions.
 * 2. No invented data — only `null` usage counts (which carry no information) are
 *    dropped. An unclassified `source.kind` is NOT auto-chosen, because picking a
 *    lawful kind is a judgement about which plugin wrote the message.
 */

function header() {
  return { type: 'session', version: 0, id: 'sess-1', createdAt: 1, cwd: '/w', delegationDepth: 0 }
}

describe('V3 format repairs', () => {
  it('plans nothing for a healthy artifact', () => {
    assert.deepEqual(findFormatRepairs([header()]), [])
  })

  it('drops a null usage token count and leaves real counts alone', () => {
    const events = [
      header(),
      { type: 'assistant/message', seq: 1, time: 2, data: { id: 'm1', role: 'assistant', source: { kind: 'model' }, content: [], usage: { inputTokens: null, outputTokens: 7, cacheReadTokens: 3 } } },
    ]
    const plans = findFormatRepairs(events)
    assert.equal(plans.length, 1)
    assert.equal(plans[0].kind, 'usage-null')
    assert.equal(plans[0].eventType, 'assistant/message')
    assert.equal(plans[0].field, 'inputTokens')
    const result = applyFormatRepair(events, plans[0])
    const usage = result.events[1].data.usage
    assert.ok(!('inputTokens' in usage), 'the null count must be dropped')
    assert.equal(usage.outputTokens, 7)
    assert.equal(usage.cacheReadTokens, 3)
    assert.deepEqual(result.changedSeqs, [1])
  })

  it('does NOT touch a same-named key on a different event type', () => {
    const events = [
      header(),
      { type: 'assistant/message', seq: 1, time: 2, data: { id: 'm1', role: 'assistant', source: { kind: 'model' }, content: [], usage: { inputTokens: null } } },
      { type: 'session/stats', seq: 2, time: 3, data: { usage: { inputTokens: null, outputTokens: 99 } } },
    ]
    const plan = findFormatRepairs(events).find(p => p.kind === 'usage-null')
    assert.ok(plan)
    assert.equal(plan.eventType, 'assistant/message')
    const result = applyFormatRepair(events, plan)
    assert.ok(!('inputTokens' in result.events[1].data.usage), 'the planned event is fixed')
    assert.equal(result.events[2].data.usage.inputTokens, null, 'the unrelated event keeps its own key')
    assert.deepEqual(result.changedSeqs, [1])
  })

  it('is idempotent: a repaired artifact yields no further plans', () => {
    const events = [
      header(),
      { type: 'assistant/message', seq: 1, time: 2, data: { id: 'm1', role: 'assistant', source: { kind: 'model' }, content: [], usage: { inputTokens: null, outputTokens: 7 } } },
    ]
    let current = events
    for (const plan of findFormatRepairs(events)) current = applyFormatRepair(current, plan).events
    assert.deepEqual(findFormatRepairs(current), [])
  })

  it('leaves an unclassified source kind to a human decision (no auto plan)', () => {
    const events = [
      header(),
      { type: 'user/message', seq: 1, time: 2, data: { id: 'm1', role: 'user', source: { kind: 'plugin:dsh-mnemon' }, content: [] } },
    ]
    assert.deepEqual(findFormatRepairs(events), [], 'choosing a lawful kind is a judgement, not a mechanical fix')
  })

  it('never rewrites a header version (the header version is the physical generation)', () => {
    const events = [header()]
    assert.deepEqual(findFormatRepairs(events), [], 'a stored header version is not a V3 defect')
  })
})
