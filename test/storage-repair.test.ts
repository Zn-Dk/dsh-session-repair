import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { repairJsonlFrames } from '../lib/repair.js'
import { decodeJsonl } from '../lib/raw-storage.js'
import { stableCopy, trustFor } from '../lib/backup-store.js'

test('repair preserves untouched zstd frames and decodes changed frame', () => {
  const header = JSON.stringify({ type: 'session', version: 0, id: 's1' }) + '\n'
  const first = JSON.stringify({ type: 'turn/start', seq: 1 }) + '\n'
  const second = JSON.stringify({ type: 'tool/call', seq: 2, data: { callId: '' } }) + '\n'
  const original = Buffer.concat([
    zstdCompressSync(Buffer.from(header), { params: { 201: 1, 200: 0 } }),
    zstdCompressSync(Buffer.from(first), { params: { 201: 1, 200: 0 } }),
    zstdCompressSync(Buffer.from(second), { params: { 201: 1, 200: 0 } }),
  ])
  const decoded = decodeJsonl(original)
  const events = structuredClone(decoded.events)
  events[2].data.callId = 'call-fixed'
  const repaired = repairJsonlFrames(original, events, [2])
  assert.equal(repaired.subarray(0, decoded.frames[0].end).equals(original.subarray(0, decoded.frames[0].end)), true)
  assert.deepEqual(decodeJsonl(repaired).events, events)
})

test('stableCopy writes a validated manifest and trust is explicit', async () => {
  const root = await mkdtemp(join(process.cwd(), '.tmp-dsh-session-repair-'))
  try {
    const source = join(root, 'source.zstd')
    await writeFile(source, Buffer.from('fixture'))
    const saved = await stableCopy(source, join(root, 'backups'), { sessionId: 's1', projectKey: 'p', cwd: '/w', maxSeq: 4, trigger: 'test', validation: { ok: true }, kind: 'checkpoint' })
    const manifest = JSON.parse(await readFile(saved.manifestPath, 'utf8'))
    assert.equal(manifest.schemaVersion, 1)
    assert.equal(manifest.trust, 'trusted')
    assert.equal(manifest.bytes, 7)
    assert.equal(trustFor({ owned: true, valid: true }), 'trusted')
    assert.equal(trustFor({ owned: false, valid: true }), 'legacy-valid')
  } finally { await rm(root, { recursive: true, force: true }) }
})
