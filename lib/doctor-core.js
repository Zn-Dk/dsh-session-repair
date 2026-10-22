import { AGENT_MESSAGE_SOURCE_KEYS, DIAGNOSTIC, KNOWN_SESSION_EVENT_TYPES, MESSAGE_BEARING_TYPES, RETIRED_SOURCE_KIND, SOURCE_KINDS, severityFor, } from './protocol.js';
function check(code, severity, message, seqs = [], details = {}) {
    return { code, severity, message, seqs, details };
}
function eventMessage(event) {
    return event?.data?.message;
}
function toolBlock(message) {
    return (message?.content ?? []).filter(x => x?.type === 'tool-call');
}
function countType(events, type) {
    return events.reduce((n, event) => n + (event.type === type ? 1 : 0), 0);
}
function structuralChecks(events, options = {}) {
    const checks = [];
    const startedTurns = countType(events, 'turn/start');
    const endedTurns = countType(events, 'turn/end');
    const startedSteps = countType(events, 'step/start');
    const endedSteps = countType(events, 'step/end');
    const hasTurns = startedTurns > 0 || endedTurns > 0;
    const hasSteps = startedSteps > 0 || endedSteps > 0;
    // A live (appending) artifact keeps its current turn/step open by design, so
    // an open boundary there is observational (info). Only a settled artifact that
    // fails to close every started turn/step is a potential problem (warning).
    const openSeverity = options.live === true ? 'info' : 'warning';
    if (hasTurns && endedTurns !== startedTurns)
        checks.push(check('turn-open', openSeverity, 'turn count is not closed', [], { startedTurns, endedTurns, live: options.live === true }));
    if (hasSteps && endedSteps !== startedSteps)
        checks.push(check('step-open', openSeverity, 'step count is not closed', [], { startedSteps, endedSteps, live: options.live === true }));
    return checks;
}
/**
 * Format-admission checks mirroring the installed engine's V3 rules.
 *
 * The engine refuses a stored Session whose `message.source.kind` is outside the
 * audited vocabulary, whose `agent-message` source carries a field that closed
 * branch does not admit, or whose `usage` reports a token count that is not a
 * non-negative safe integer. Those rules live in the migration/validation
 * packages; this mirrors the observable outcomes so a report from this plugin
 * matches what the engine will decide.
 *
 * Deliberately narrow: the engine validates source FIELD names only for the
 * `agent-message` kind, so no wider key vocabulary is asserted here. An earlier
 * revision guessed one and reported lawful `form`/`provider` keys as defects.
 * @param events - decoded Session events, header first.
 * @returns one check per violated rule.
 */
function formatChecks(events) {
    const checks = [];
    const header = events[0];
    // The closed `source.kind` vocabulary applies to HISTORICAL v3 artifacts
    // (the V3→V4 migration refuses an unclassifiable kind). A current v4
    // artifact is NOT checked against it: the v4 reader admits any
    // producer-owned kind and only refuses the retired `plugin` wrapper.
    //
    // Checking v4 artifacts against the closed set reported lawful
    // first-party kinds (`time-context`, `runtime-context`, `user-approval`,
    // `tool-registry`, `tool-jobs`, ...) as blocked defects, which made every
    // healthy modern session look corrupt and offered no repair.
    const isHistoricalV3 = header?.version === 3;
    for (const event of events) {
        if (typeof event.type !== 'string' || !MESSAGE_BEARING_TYPES.has(event.type))
            continue;
        const message = event.type === 'user/message' ? event.data : eventMessage(event);
        const source = message?.source;
        if (source === undefined || source === null || typeof source !== 'object')
            continue;
        const kind = source['kind'];
        if (typeof kind !== 'string' || kind.length === 0) {
            checks.push(check(DIAGNOSTIC.SOURCE_KIND_UNCLASSIFIED, 'blocked', 'message source kind is missing or empty', [event.seq ?? 0], { eventType: event.type, kind: null }));
            continue;
        }
        // The retired plugin wrapper is refused by every generation.
        if (kind === RETIRED_SOURCE_KIND) {
            checks.push(check(DIAGNOSTIC.SOURCE_KIND_UNCLASSIFIED, 'blocked', 'message source uses the retired "plugin" wrapper kind', [event.seq ?? 0], { eventType: event.type, kind }));
            continue;
        }
        // Only a historical v3 artifact is checked against the closed set.
        if (isHistoricalV3 && !SOURCE_KINDS.has(kind)) {
            checks.push(check(DIAGNOSTIC.SOURCE_KIND_UNCLASSIFIED, 'blocked', 'message source kind is outside the audited vocabulary', [event.seq ?? 0], { eventType: event.type, kind }));
            // A kind the vocabulary does not know cannot be checked further.
            continue;
        }
        if (isHistoricalV3 && kind === 'agent-message') {
            const unexpected = Object.keys(source).filter(key => !AGENT_MESSAGE_SOURCE_KEYS.includes(key));
            if (unexpected.length > 0) {
                checks.push(check(DIAGNOSTIC.SOURCE_FIELD_UNEXPECTED, 'repairable', 'agent-message source carries a field its closed shape does not admit', [event.seq ?? 0], { eventType: event.type, fields: unexpected }));
            }
        }
    }
    checks.push(...usageChecks(events));
    return checks;
}
/** Reject token counts that are not non-negative safe integers (engine rule). */
function usageChecks(events) {
    const checks = [];
    for (const event of events) {
        const usage = event.data?.usage;
        if (usage === undefined || usage === null || typeof usage !== 'object')
            continue;
        for (const [key, value] of Object.entries(usage)) {
            if (value === null) {
                checks.push(check(DIAGNOSTIC.USAGE_NULL_TOKEN, 'repairable', 'usage reports a null token count', [event.seq ?? 0], { field: key }));
                continue;
            }
            if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) {
                checks.push(check(DIAGNOSTIC.USAGE_NULL_TOKEN, 'blocked', 'usage reports a token count that is not a non-negative safe integer', [event.seq ?? 0], { field: key, value }));
            }
        }
    }
    return checks;
}
export function validateEvents(events, requestedSessionId, artifact = {}, options = {}) {
    const checks = [];
    const first = events[0];
    if (!first || first.type !== 'session')
        checks.push(check(DIAGNOSTIC.JSON_INVALID, 'blocked', 'session header is missing'));
    const headerId = first?.id ?? first?.data?.id;
    if (requestedSessionId && headerId && headerId !== requestedSessionId)
        checks.push(check(DIAGNOSTIC.SESSION_ID_MISMATCH, 'blocked', 'session header id differs from requested id', [], { headerId, requestedSessionId }));
    if (artifact.stable === false)
        checks.push(check('artifact-unstable', 'blocked', 'artifact changed while being read'));
    const seqs = events.map(e => e.seq).filter((s) => Number.isInteger(s));
    const seen = new Set();
    for (const seq of seqs) {
        if (seen.has(seq))
            checks.push(check(DIAGNOSTIC.SEQ_DUPLICATE, 'blocked', 'duplicate event sequence', [seq]));
        seen.add(seq);
    }
    // Gaps are aggregated into ONE informational check: a Session whose events were
    // trimmed (subagent inheritance, compaction) legitimately carries many jumps, and
    // one check per jump buried every other finding under hundreds of identical rows.
    let gapCount = 0;
    let firstGap;
    for (let i = 1; i < seqs.length; i++) {
        if (seqs[i] <= seqs[i - 1])
            checks.push(check('seq-not-increasing', 'blocked', 'event sequence is not increasing', [seqs[i - 1], seqs[i]]));
        if (seqs[i] > seqs[i - 1] + 1) {
            gapCount++;
            firstGap ??= [seqs[i - 1], seqs[i]];
        }
    }
    if (gapCount > 0 && firstGap !== undefined) {
        checks.push(check(DIAGNOSTIC.SEQ_GAP, 'info', 'event sequence has gaps', firstGap, { gapCount }));
    }
    const calls = new Map(), results = [];
    for (const event of events) {
        if (event.type === 'assistant/message')
            for (const block of toolBlock(eventMessage(event))) {
                const id = block.id;
                if (!id)
                    checks.push(check(DIAGNOSTIC.TOOL_CALL_ID_EMPTY, 'repairable', 'assistant tool-call id is empty', [event.seq ?? 0], { role: 'assistant', name: block.name }));
            }
        if (event.type === 'tool/call') {
            const id = event.data?.callId;
            if (!id)
                checks.push(check(DIAGNOSTIC.TOOL_CALL_ID_EMPTY, 'repairable', 'tool/call callId is empty', [event.seq ?? 0], { role: 'call', name: event.data?.name }));
            if (id && calls.has(id))
                checks.push(check(DIAGNOSTIC.TOOL_CALL_ID_REUSED, 'blocked', 'tool call id is reused', [event.seq ?? 0, calls.get(id)?.seq ?? 0], { id }));
            if (id)
                calls.set(id, event);
        }
        if (event.type === 'tool/result') {
            const message = event.data?.message;
            const id = message?.source?.callId ?? message?.content?.[0]?.toolCallId;
            if (!id)
                checks.push(check(DIAGNOSTIC.TOOL_CALL_ID_EMPTY, 'repairable', 'tool/result callId is empty', [event.seq ?? 0]));
            // The engine's own rule (`assertMessageEventShape`) compares the
            // message-level `toolCallId` with `source.callId`:
            //
            //   if (messageRecord["toolCallId"] !== sourceRecord["callId"])
            //       throw new Error(`${subject} message has mismatched tool call ids`)
            //
            // It does NOT compare against `content[0].toolCallId`. The content
            // array's first block is usually a TEXT block, so that field is
            // legitimately undefined — the previous rule compared `source.callId`
            // against `content[0].toolCallId` and therefore reported EVERY
            // healthy tool result as a blocked "identifiers differ" defect.
            if (message?.source?.callId !== undefined && message?.toolCallId !== undefined
                && message.source.callId !== message.toolCallId) {
                checks.push(check(DIAGNOSTIC.TOOL_CALL_ID_MISMATCH, 'blocked', 'tool result message toolCallId differs from source.callId', [event.seq ?? 0]));
            }
            results.push({ event, id });
        }
        // The engine's fail-closed event vocabulary gate. An event whose type
        // is outside the installed vocabulary AND that is not marked
        // `ignorable: true` makes the WHOLE log uninterpretable — this is the
        // single most common way a third-party plugin bricks a session.
        if (event.type !== 'session' && typeof event.type === 'string'
            && !KNOWN_SESSION_EVENT_TYPES.has(event.type) && event.ignorable !== true) {
            checks.push(check(DIAGNOSTIC.EVENT_TYPE_UNKNOWN, 'repairable',
                'event type is outside the engine vocabulary and is not marked ignorable; the engine refuses to open this session',
                [event.seq ?? 0], { eventType: event.type }));
        }
    }
    for (const result of results)
        if (result.id && !calls.has(result.id))
            checks.push(check(DIAGNOSTIC.TOOL_CALL_UNPAIRED, 'blocked', 'tool result has no matching call', [result.event.seq ?? 0], { id: result.id }));
    for (const item of formatChecks(events))
        checks.push(item);
    for (const item of structuralChecks(events, options))
        checks.push(item);
    const deduped = [];
    const keys = new Set();
    for (const item of checks) {
        const key = item.code + ':' + item.seqs.join(',') + ':' + item.message;
        if (!keys.has(key)) {
            keys.add(key);
            deduped.push(item);
        }
    }
    return { severity: severityFor(deduped), checks: deduped, maxSeq: Math.max(0, ...seqs), eventCount: events.length, artifact: artifact.fingerprint ?? null };
}
//# sourceMappingURL=doctor-core.js.map