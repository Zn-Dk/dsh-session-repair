import { DIAGNOSTIC, severityFor, type DiagnosticCheck, type CheckSeverity, type Severity } from './protocol.js'

export interface ValidateOptions { live?: boolean }
export interface ValidationReport {
  severity: Severity
  checks: DiagnosticCheck[]
  maxSeq: number
  eventCount: number
  artifact: unknown
}

interface SessionEvent {
  type?: string
  id?: string
  seq?: number
  data?: {
    turn?: number
    step?: number
    callId?: string
    name?: string
    message?: {
      content?: Array<{
        type?: string
        id?: string
        name?: string
        toolCallId?: string
      }>
      source?: { kind?: string; callId?: string }
    }
    [key: string]: unknown
  }
}

function check(code: string, severity: CheckSeverity, message: string, seqs: number[] = [], details: Record<string, unknown> = {}): DiagnosticCheck {
  return { code, severity, message, seqs, details }
}
interface MessageBlock { type?: string; id?: string; name?: string; toolCallId?: string }
interface EventMessage { content?: MessageBlock[]; source?: { kind?: string; callId?: string } }
function eventMessage(event: SessionEvent): EventMessage | undefined {
  return event?.data?.message
}
function toolBlock(message: EventMessage | undefined): MessageBlock[] {
  return (message?.content ?? []).filter(x => x?.type === 'tool-call')
}
function countType(events: SessionEvent[], type: string): number {
  return events.reduce((n, event) => n + (event.type === type ? 1 : 0), 0)
}
function structuralChecks(events: SessionEvent[], options: ValidateOptions = {}): DiagnosticCheck[] {
  const checks: DiagnosticCheck[] = []
  const startedTurns = countType(events, 'turn/start')
  const endedTurns = countType(events, 'turn/end')
  const startedSteps = countType(events, 'step/start')
  const endedSteps = countType(events, 'step/end')
  const hasTurns = startedTurns > 0 || endedTurns > 0
  const hasSteps = startedSteps > 0 || endedSteps > 0
  // A live (appending) artifact keeps its current turn/step open by design, so
  // an open boundary there is observational (info). Only a settled artifact that
  // fails to close every started turn/step is a potential problem (warning).
  const openSeverity: CheckSeverity = options.live === true ? 'info' : 'warning'
  if (hasTurns && endedTurns !== startedTurns) checks.push(check('turn-open', openSeverity, 'turn count is not closed', [], { startedTurns, endedTurns, live: options.live === true }))
  if (hasSteps && endedSteps !== startedSteps) checks.push(check('step-open', openSeverity, 'step count is not closed', [], { startedSteps, endedSteps, live: options.live === true }))
  return checks
}

export function validateEvents(events: SessionEvent[], requestedSessionId: string, artifact: { stable?: boolean; fingerprint?: unknown } = {}, options: ValidateOptions = {}): ValidationReport {
  const checks: DiagnosticCheck[] = []
  const first = events[0]
  if (!first || first.type !== 'session') checks.push(check(DIAGNOSTIC.JSON_INVALID, 'blocked', 'session header is missing'))
  const headerId = first?.id ?? first?.data?.id
  if (requestedSessionId && headerId && headerId !== requestedSessionId) checks.push(check(DIAGNOSTIC.SESSION_ID_MISMATCH, 'blocked', 'session header id differs from requested id', [], { headerId, requestedSessionId }))
  if (artifact.stable === false) checks.push(check('artifact-unstable', 'blocked', 'artifact changed while being read'))
  const seqs = events.map(e => e.seq).filter((s): s is number => Number.isInteger(s))
  const seen = new Set<number>()
  for (const seq of seqs) { if (seen.has(seq)) checks.push(check(DIAGNOSTIC.SEQ_DUPLICATE, 'blocked', 'duplicate event sequence', [seq])); seen.add(seq) }
  for (let i = 1; i < seqs.length; i++) {
    if (seqs[i] <= seqs[i - 1]) checks.push(check('seq-not-increasing', 'blocked', 'event sequence is not increasing', [seqs[i - 1], seqs[i]]))
    if (seqs[i] > seqs[i - 1] + 1) checks.push(check(DIAGNOSTIC.SEQ_GAP, 'info', 'event sequence has a gap', [seqs[i - 1], seqs[i]]))
  }
  const calls = new Map<string, SessionEvent>(), results: Array<{ event: SessionEvent; id: string | undefined }> = []
  for (const event of events) {
    if (event.type === 'assistant/message') for (const block of toolBlock(eventMessage(event))) {
      const id = block.id
      if (!id) checks.push(check(DIAGNOSTIC.TOOL_CALL_ID_EMPTY, 'repairable', 'assistant tool-call id is empty', [event.seq ?? 0], { role: 'assistant', name: block.name }))
    }
    if (event.type === 'tool/call') {
      const id = event.data?.callId
      if (!id) checks.push(check(DIAGNOSTIC.TOOL_CALL_ID_EMPTY, 'repairable', 'tool/call callId is empty', [event.seq ?? 0], { role: 'call', name: event.data?.name }))
      if (id && calls.has(id)) checks.push(check(DIAGNOSTIC.TOOL_CALL_ID_REUSED, 'blocked', 'tool call id is reused', [event.seq ?? 0, calls.get(id)?.seq ?? 0], { id }))
      if (id) calls.set(id, event)
    }
    if (event.type === 'tool/result') {
      const message = event.data?.message
      const id = message?.source?.callId ?? message?.content?.[0]?.toolCallId
      if (!id) checks.push(check(DIAGNOSTIC.TOOL_CALL_ID_EMPTY, 'repairable', 'tool/result callId is empty', [event.seq ?? 0]))
      if (message?.source?.callId !== message?.content?.[0]?.toolCallId) checks.push(check(DIAGNOSTIC.TOOL_CALL_ID_MISMATCH, 'blocked', 'tool result identifiers differ', [event.seq ?? 0]))
      results.push({ event, id })
    }
  }
  for (const result of results) if (result.id && !calls.has(result.id)) checks.push(check(DIAGNOSTIC.TOOL_CALL_UNPAIRED, 'blocked', 'tool result has no matching call', [result.event.seq ?? 0], { id: result.id }))
  for (const item of structuralChecks(events, options)) checks.push(item)
  const deduped: DiagnosticCheck[] = []
  const keys = new Set<string>()
  for (const item of checks) { const key = item.code + ':' + item.seqs.join(',') + ':' + item.message; if (!keys.has(key)) { keys.add(key); deduped.push(item) } }
  return { severity: severityFor(deduped), checks: deduped, maxSeq: Math.max(0, ...seqs), eventCount: events.length, artifact: artifact.fingerprint ?? null }
}
