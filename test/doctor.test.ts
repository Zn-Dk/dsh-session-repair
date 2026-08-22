import test from 'node:test'
import assert from 'node:assert/strict'
import { scanFrames, decodeJsonl } from '../lib/raw-storage.js'
import { validateEvents } from '../lib/doctor-core.js'
import { zstdCompressSync } from 'node:zlib'

function frame(text) { return zstdCompressSync(Buffer.from(text), { params: { 201: 1, 200: 0 } }) }
function chain({ empty = true } = {}) {
  const id = empty ? '' : 'call-ok'
  return [
    { type: 'session', version: 0, id: 's1' },
    { type: 'assistant/message', seq: 1, data: { message: { content: [{ type: 'tool-call', id, name: 'run_code' }] } } },
    { type: 'tool/call', seq: 2, data: { callId: id, name: 'run_code' } },
    { type: 'tool/result', seq: 3, data: { message: { source: { kind: 'tool', callId: id }, content: [{ type: 'tool-result', toolCallId: id }] } } },
  ]
}
test('decodes zstd JSONL frames', () => {
  const bytes = Buffer.concat([frame(JSON.stringify({ type: 'session', id: 's1' }) + '\n'), frame(JSON.stringify({ type: 'turn/end', seq: 1 }) + '\n')])
  assert.equal(scanFrames(bytes).length, 2)
  assert.equal(decodeJsonl(bytes).events.length, 2)
})
test('reports empty tool identifiers as repairable', () => {
  const report = validateEvents(chain(), 's1')
  assert.equal(report.severity, 'repairable')
  assert.equal(report.checks.filter(x => x.code === 'tool-call-id-empty').length, 3)
})
test('healthy tool chain has no checks', () => {
  assert.equal(validateEvents(chain({ empty: false }), 's1').severity, 'healthy')
})
test('identity mismatch is blocked', () => {
  const report = validateEvents(chain({ empty: false }), 'other')
  assert.equal(report.severity, 'blocked')
  assert.equal(report.checks[0].code, 'session-id-mismatch')
})
test('settled artifact with an open turn is a warning', () => {
  const settledOpen = [
    { type: 'session', id: 's1' },
    { type: 'turn/start', seq: 1, data: { turn: 1 } },
  ]
  const report = validateEvents(settledOpen, 's1')
  assert.equal(report.severity, 'warning')
  const turnOpen = report.checks.find(x => x.code === 'turn-open')
  assert.equal(turnOpen.severity, 'warning')
})
test('live artifact with an open turn stays healthy', () => {
  const liveOpen = [
    { type: 'session', id: 's1' },
    { type: 'turn/start', seq: 1, data: { turn: 1 } },
  ]
  const report = validateEvents(liveOpen, 's1', {}, { live: true })
  assert.equal(report.severity, 'healthy')
  const turnOpen = report.checks.find(x => x.code === 'turn-open')
  assert.equal(turnOpen.severity, 'info')
})
test('seq-gap is informational and does not raise severity', () => {
  const gapped = [
    { type: 'session', id: 's1' },
    { type: 'turn/start', seq: 1, data: { turn: 1 } },
    { type: 'turn/end', seq: 40, data: { turn: 1 } },
  ]
  const report = validateEvents(gapped, 's1')
  assert.equal(report.severity, 'healthy')
  assert.equal(report.checks.find(x => x.code === 'seq-gap').severity, 'info')
})
