# dsh-session-repair

> **English** | [中文](./README.zh.md)

A DSH Web plugin for session diagnosis, trusted checkpoints, pre-repair backups, and safe repair.

## Installation

### From npm (recommended)

    dsh plugin --profile web add dsh-session-repair

Restart `dsh web` after installation, then refresh http://127.0.0.1:3080.

### From GitHub

    dsh plugin --profile web add github:Zn-Dk/dsh-session-repair

### Development: link local source

    cd /root/proj/dsh-proj/dsh-session-repair
    pnpm install
    pnpm build
    dsh plugin --profile web add link:/root/proj/dsh-proj/dsh-session-repair

After modifying the source, restart the existing `dsh web` process; do not start a replacement server. If the deepseek-harness `dev:web` watcher is running, the Client bundle can receive updates through the existing HMR.

## Severity levels

The `severity` of a diagnostic report is derived from its checks and decides whether writable repair entry points are shown:

| status | case-when |
| --- | --- |
| `healthy` | No blocked/repairable/warning checks. `seq-gap` and unclosed turn/step in a live session are informational only and do not raise the level. |
| `warning` | A settled (non-live) history contains unclosed turn/step structures or other potential issues. Readable; no writable repair is offered. |
| `repairable` | Deterministically fixable issues exist (e.g. empty tool-call ID chains); a repair plan can be submitted. |
| `blocked` | The session cannot be displayed normally and has a hard conflict that cannot be auto-fixed (ID conflict, zstd damage, session mismatch). |

## Usage

Open any session and click **Session Health Check** in the Chat header. When the report is `repairable` and has at least one deterministic repair plan, the panel shows a **Backup & Repair** button and lists every seq chain to fix. Clicking it first confirms the target seqs and the pre-repair backup, then applies the repair in one batch and revalidates; ambiguous, live, changed-artifact, or otherwise blocked states never show a writable repair button.

Panel buttons:

- **Refresh**: re-reads the current session artifact and updates the report.
- **Copy Report**: copies the diagnostic JSON to the clipboard.
- **Export Report**: downloads the diagnostic report as a JSON file.
- **Restore Pre-Repair**: shown only when the session is `repairable`/`blocked` and a pre-repair backup exists; one-click rollback to the state before the most recent repair.
- **Clear Backups**: manually clears safety backups.
- **Backup & Repair**: shown only when the report is `repairable` and a deterministic repair plan exists.

### Agent tool (model-invoked)

The plugin registers a **model-invokable tool** `dsh_session_repair`. It is not user-triggered manually; the agent decides when to call it:

- Arguments: `sessionId` (optional; defaults to the current session)
- Returns: a structured diagnostic report (severity / checks / repairPlans / maxSeq / eventCount, etc.)

Typical usage:

1. In a **healthy session**, tell the agent: "diagnose the history-unavailable session session-xxxx" — the agent calls `dsh_session_repair` with the old sessionId.
2. In the current session, tell the agent: "health-check the current session" — the agent calls it without sessionId.

Note: this tool is **read-only diagnosis**; it never repairs. Repair still requires the **Session Health Check** panel in the header.

## Safety boundary

The Host reads raw storage first, then decides whether to call engine display APIs. The Client never touches `~/.dsh` directly and cannot submit arbitrary JSON patches. Repair uses a batchId and an artifact fingerprint, always creates a pre-repair backup before repairing, and atomically replaces only after revalidation. Multiple independent empty-ID chains are fixed in one batch; ambiguous chains, zstd damage, changed files, and live/appending sessions are never written. Live sessions are detected via `ctx.get('sessions')` / `ctx.get('agents')`; their unclosed turn/step are normal appending states and are only recorded as info.

Plugin-owned data lives under `~/.dsh/session-repair/`, including backups and audit. External `~/.dsh/backup-sessions-*` directories are used only as legacy forensics/comparison sources and are not auto-restored by default.

## Current implementation status

The repository includes raw zstd/JSONL diagnosis, tool-call ID checks, deterministic repair plans, checkpoint/pre-repair backup writes, backup listing/comparison, report export, RPC, the Agent tool, a header report panel, and a bundled Skill. All endpoints are implemented or explicitly return not-implemented; nothing pretends to succeed.

## Release & listing

- npm: [dsh-session-repair](https://www.npmjs.com/package/dsh-session-repair)
- GitHub: https://github.com/Zn-Dk/dsh-session-repair
- Listing: PR submitted to https://github.com/awesome-dsh-plugin/awesome-dsh-plugin (`data/plugins/Zn-Dk__dsh-session-repair.yml`, category: `session`)

## Skill

The bundled Skill is published at `skills/dsh-session-repair/SKILL.md` and registered by the Host runtime; it shares the plugin name but belongs to a different registry. It is not published separately, does not use a submodule, and is not symlinked by default.
