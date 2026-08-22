---
name: dsh-session-repair
description: Diagnose and safely repair corrupted DeepSeek Harness session history.
when-to-use: Use when history is unavailable, session persistence validation fails, tool-call IDs are missing, or the user asks to inspect/repair a DSH session.
---

# dsh-session-repair

Use the Host tool dsh_session_repair as the source of facts. Do not reimplement zstd parsing or edit ~/.dsh directly.

## Using the tool

The plugin registers a model-invoked tool `dsh_session_repair` (not user-triggerable; no slash command or button). Invoke it by asking the agent:

- `dsh_session_repair({ sessionId: "session-xxxx" })` — diagnose a specific (possibly history-unavailable) session from a healthy conversation.
- `dsh_session_repair()` — diagnose the current session.

It returns a read-only structured report (severity / checks / repairPlans / maxSeq / eventCount). It never repairs; repair still requires the header "会话体检" panel.

## Workflow

1. If the current conversation is healthy, diagnose it by default. If it is history unavailable, run this Skill from a healthy conversation and pass the old sessionId explicitly.
2. Read the structured report before forming a hypothesis. Treat the report as authoritative for artifact, sequence, identity, and tool-chain facts.
3. Trust backup sources explicitly: trusted means plugin-created and fully validated; legacy-valid means an external file passed validation but has no plugin provenance; unverified and invalid are not automatic recovery sources.
4. Only a unique, deterministic repair plan may be sent to the header UI for user confirmation. Never submit an arbitrary JSON patch.
5. Any ambiguous chain, ID/header conflict, zstd damage, live or appending session, changed fingerprint, missing lock, or unknown schema is analysis-only: explain evidence and propose a plan without writing.
6. Repair requires explicit user confirmation and must produce a pre-repair backup, atomic replacement, full revalidation, and audit result.

The plugin and this Skill share the dsh-session-repair name but are one deliverable, not two packages.
