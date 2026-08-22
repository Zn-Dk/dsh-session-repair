import { createHash, randomUUID } from 'node:crypto'
import { rename, writeFile } from 'node:fs/promises'
import { zstdCompressSync } from 'node:zlib'
import { decodeJsonl, scanFrames } from './raw-storage.js'

export function fingerprint(bytes) { return { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } }
export function findEmptyToolChains(events) {
  const plans = []
  for (let i = 0; i < events.length; i++) {
    const assistant = events[i]
    const block = assistant.type === 'assistant/message'
      ? (assistant.data?.message?.content ?? []).find(x => x?.type === 'tool-call' && !x.id)
      : undefined
    if (!block) continue
    const callCandidates = events.slice(i + 1).filter(event => {
      if (event.type !== 'tool/call' || event.data?.callId || event.data?.name !== block.name) return false
      return event.data?.turn === assistant.data?.turn && event.data?.step === assistant.data?.step
    })
    if (callCandidates.length !== 1) continue
    const call = callCandidates[0]
    const resultCandidates = events.filter(event => {
      if (event.type !== 'tool/result' || event.data?.message?.source?.callId) return false
      const refs = event.sourceEventSeqs ?? []
      if (refs.includes(call.seq)) return true
      return event.data?.turn === call.data?.turn && event.data?.step === call.data?.step
    })
    if (resultCandidates.length !== 1) continue
    const result = resultCandidates[0]
    plans.push({ repairId: 'repair-' + randomUUID(), seqs: [assistant.seq, call.seq, result.seq], callSeq: call.seq, resultSeq: result.seq, assistantSeq: assistant.seq, name: block.name })
  }
  return plans
}
export function applyEmptyToolChain(events, plan) {
  const id = 'call_repair_' + plan.repairId.slice(-12)
  const out = structuredClone(events)
  for (const event of out) {
    if (event.seq === plan.assistantSeq) for (const block of event.data?.message?.content ?? []) if (block.type === 'tool-call' && !block.id) block.id = id
    if (event.seq === plan.callSeq) event.data.callId = id
    if (event.seq === plan.resultSeq) { event.data.message.source.callId = id; for (const block of event.data.message.content ?? []) if (block.type === 'tool-result') block.toolCallId = id }
  }
  return { events: out, callId: id }
}
export function applyEmptyToolChains(events, plans) {
  const out = structuredClone(events)
  const callIds = new Map()
  for (const plan of plans) {
    const id = 'call_repair_' + plan.repairId.slice(-12)
    callIds.set(plan.repairId, id)
    for (const event of out) {
      if (event.seq === plan.assistantSeq) for (const block of event.data?.message?.content ?? []) if (block.type === 'tool-call' && !block.id) block.id = id
      if (event.seq === plan.callSeq) event.data.callId = id
      if (event.seq === plan.resultSeq) { event.data.message.source.callId = id; for (const block of event.data.message.content ?? []) if (block.type === 'tool-result') block.toolCallId = id }
    }
  }
  return { events: out, callIds }
}
export function repairJsonlFrames(originalBytes, events, changedSeqs) {
  const decoded = decodeJsonl(originalBytes)
  const changed = new Set(changedSeqs)
  if (decoded.events.length !== events.length) throw new Error('event count changed during repair')
  const rebuilt = []
  let cursor = 0
  for (let index = 0; index < decoded.frames.length; index++) {
    const originalEvents = decoded.frameEvents[index] ?? []
    const replacement = events.slice(cursor, cursor + originalEvents.length)
    if (replacement.length !== originalEvents.length) throw new Error('frame reconstruction did not consume frame events')
    const frameChanged = replacement.some(event => changed.has(event.seq))
    if (!frameChanged) rebuilt.push(originalBytes.subarray(decoded.frames[index].start, decoded.frames[index].end))
    else {
      const text = replacement.map(event => JSON.stringify(event)).join('\n') + (replacement.length ? '\n' : '')
      rebuilt.push(zstdCompressSync(Buffer.from(text), { params: { 201: 1, 200: 0 } }))
    }
    cursor += originalEvents.length
  }
  if (cursor !== events.length) throw new Error('frame reconstruction did not consume all events')
  return Buffer.concat(rebuilt)
}
export async function atomicWrite(path, bytes) {
  const tmp = path + '.repair-tmp-' + randomUUID()
  await writeFile(tmp, bytes, { mode: 0o600 })
  await rename(tmp, path)
}
