import { createHash, randomUUID } from 'node:crypto';
import { rename, writeFile } from 'node:fs/promises';
import { zstdCompressSync } from 'node:zlib';
import { SESSION_FORMAT_VERSION } from './protocol.js';
import { decodeJsonl } from './raw-storage.js';
export function fingerprint(bytes) {
    return { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}
export function findEmptyToolChains(events) {
    const plans = [];
    for (let i = 0; i < events.length; i++) {
        const assistant = events[i];
        const block = assistant.type === 'assistant/message'
            ? (assistant.data?.message?.content ?? []).find(x => x?.type === 'tool-call' && !x.id)
            : undefined;
        if (!block)
            continue;
        const callCandidates = events.slice(i + 1).filter(event => {
            if (event.type !== 'tool/call' || event.data?.callId || event.data?.name !== block.name)
                return false;
            return event.data?.turn === assistant.data?.turn && event.data?.step === assistant.data?.step;
        });
        if (callCandidates.length !== 1)
            continue;
        const call = callCandidates[0];
        const resultCandidates = events.filter(event => {
            if (event.type !== 'tool/result' || event.data?.message?.source?.callId)
                return false;
            const refs = event.sourceEventSeqs ?? [];
            if (refs.includes(call.seq))
                return true;
            return event.data?.turn === call.data?.turn && event.data?.step === call.data?.step;
        });
        if (resultCandidates.length !== 1)
            continue;
        const result = resultCandidates[0];
        plans.push({ repairId: 'repair-' + randomUUID(), seqs: [assistant.seq, call.seq, result.seq], callSeq: call.seq, resultSeq: result.seq, assistantSeq: assistant.seq, name: block.name });
    }
    return plans;
}
export function applyEmptyToolChain(events, plan) {
    const id = 'call_repair_' + plan.repairId.slice(-12);
    const out = structuredClone(events);
    for (const event of out) {
        if (event.seq === plan.assistantSeq)
            for (const block of event.data?.message?.content ?? [])
                if (block.type === 'tool-call' && !block.id)
                    block.id = id;
        if (event.seq === plan.callSeq)
            event.data.callId = id;
        if (event.seq === plan.resultSeq) {
            event.data.message.source.callId = id;
            for (const block of event.data.message.content ?? [])
                if (block.type === 'tool-result')
                    block.toolCallId = id;
        }
    }
    return { events: out, callId: id };
}
export function applyEmptyToolChains(events, plans) {
    const out = structuredClone(events);
    const callIds = new Map();
    for (const plan of plans) {
        const id = 'call_repair_' + plan.repairId.slice(-12);
        callIds.set(plan.repairId, id);
        for (const event of out) {
            if (event.seq === plan.assistantSeq)
                for (const block of event.data?.message?.content ?? [])
                    if (block.type === 'tool-call' && !block.id)
                        block.id = id;
            if (event.seq === plan.callSeq)
                event.data.callId = id;
            if (event.seq === plan.resultSeq) {
                event.data.message.source.callId = id;
                for (const block of event.data.message.content ?? [])
                    if (block.type === 'tool-result')
                        block.toolCallId = id;
            }
        }
    }
    return { events: out, callIds };
}
/**
 * Detect repairable V3 format defects as exact per-event plans.
 *
 * Only two transformations are mechanical enough to perform without inventing
 * data:
 * - a header naming a non-current version is restamped to the installed one;
 * - a `null` usage token count is dropped, because the engine requires a
 *   non-negative safe integer and `null` carries no count.
 * Unclassified `source.kind` and unadmitted `source` fields are detected by the
 * doctor but NOT planned here: choosing a lawful kind or deciding which field
 * to sacrifice is a judgement about plugin intent, so it is left to a human or
 * to the plugin that wrote the field.
 * @param events - decoded Session events, header first.
 * @returns ordered plans for the mechanical fixes only.
 */
export function findFormatRepairs(events) {
    const plans = [];
    const header = events[0];
    const headerVersion = header?.data?.version;
    if (Number.isInteger(headerVersion) && headerVersion !== SESSION_FORMAT_VERSION) {
        plans.push({
            repairId: 'format-' + randomUUID(),
            eventType: 'session',
            kind: 'format-version',
            seqs: [header?.seq ?? 0],
            observed: headerVersion,
        });
    }
    for (const event of events) {
        const usage = event.data?.usage;
        if (usage === undefined || usage === null || typeof usage !== 'object')
            continue;
        const nullKeys = Object.entries(usage).filter(([, value]) => value === null).map(([key]) => key);
        if (nullKeys.length === 0)
            continue;
        plans.push({
            repairId: 'usage-' + randomUUID(),
            eventType: String(event.type),
            kind: 'usage-null',
            seqs: [event.seq ?? 0],
            field: nullKeys[0],
            observed: nullKeys,
        });
    }
    return plans;
}
/**
 * Apply one format plan. Only events matching the plan's exact `eventType` are
 * touched, and only the named field is changed.
 * @param events - decoded Session events.
 * @param plan - the plan returned by {@link findFormatRepairs}.
 * @returns the rewritten events and the seqs that actually changed.
 */
export function applyFormatRepair(events, plan) {
    const out = structuredClone(events);
    const changed = [];
    for (const event of out) {
        if (String(event.type) !== plan.eventType)
            continue;
        if (!plan.seqs.includes(event.seq ?? 0))
            continue;
        if (plan.kind === 'format-version') {
            const data = event.data;
            if (data === undefined || data.version === SESSION_FORMAT_VERSION)
                continue;
            data.version = SESSION_FORMAT_VERSION;
            changed.push(event.seq ?? 0);
            continue;
        }
        if (plan.kind === 'usage-null') {
            const usage = event.data?.usage;
            if (usage === undefined || plan.field === undefined)
                continue;
            if (usage[plan.field] !== null)
                continue;
            delete usage[plan.field];
            changed.push(event.seq ?? 0);
        }
    }
    return { events: out, changedSeqs: changed };
}
export function repairJsonlFrames(originalBytes, events, changedSeqs) {
    const decoded = decodeJsonl(originalBytes);
    const changed = new Set(changedSeqs);
    if (decoded.events.length !== events.length)
        throw new Error('event count changed during repair');
    const rebuilt = [];
    let cursor = 0;
    for (let index = 0; index < decoded.frames.length; index++) {
        const originalEvents = decoded.frameEvents[index] ?? [];
        const replacement = events.slice(cursor, cursor + originalEvents.length);
        if (replacement.length !== originalEvents.length)
            throw new Error('frame reconstruction did not consume frame events');
        const frameChanged = replacement.some(event => changed.has(event.seq));
        if (!frameChanged)
            rebuilt.push(originalBytes.subarray(decoded.frames[index].start, decoded.frames[index].end));
        else {
            const text = replacement.map(event => JSON.stringify(event)).join('\n') + (replacement.length ? '\n' : '');
            rebuilt.push(zstdCompressSync(Buffer.from(text), { params: { 201: 1, 200: 0 } }));
        }
        cursor += originalEvents.length;
    }
    if (cursor !== events.length)
        throw new Error('frame reconstruction did not consume all events');
    return Buffer.concat(rebuilt);
}
export async function atomicWrite(path, bytes) {
    const tmp = path + '.repair-tmp-' + randomUUID();
    await writeFile(tmp, bytes, { mode: 0o600 });
    await rename(tmp, path);
}
//# sourceMappingURL=repair.js.map