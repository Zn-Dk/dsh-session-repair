import { mkdir, open, readFile, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { randomUUID } from 'node:crypto'

export function trustFor({ owned, valid }) { return owned ? (valid ? 'trusted' : 'invalid') : (valid ? 'legacy-valid' : 'unverified') }
export function manifestFor({ sessionId, projectKey, cwd, sourcePath, bytes, maxSeq, trigger, validation, trusted }) {
  return { schemaVersion: 1, sessionId, projectKey, cwd: cwd ?? null, sourcePath, capturedAt: new Date().toISOString(), trigger, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), maxSeq, format: 'jsonl.zstd', validation, trust: trusted ? 'trusted' : 'unverified' }
}
export function backupDirectory(root, projectKey, sessionId) { return join(root, 'backups', projectKey, sessionId) }
export async function stableCopy(sourcePath, targetDir, meta) {
  const before = await stat(sourcePath)
  const bytes = await readFile(sourcePath)
  const after = await stat(sourcePath)
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || bytes.length !== after.size) throw Object.assign(new Error('source changed while backing up'), { code: 'artifact-unstable' })
  await mkdir(targetDir, { recursive: true, mode: 0o700 })
  const id = randomUUID()
  const artifactPath = join(targetDir, meta.kind + '-' + id + '.jsonl.zstd')
  const manifestPath = artifactPath + '.manifest.json'
  const manifest = manifestFor({ ...meta, bytes, sourcePath, trusted: meta.trusted !== false })
  const tmpArtifact = artifactPath + '.tmp'
  const tmpManifest = manifestPath + '.tmp'
  const artifactHandle = await open(tmpArtifact, 'w', 0o600)
  try { await artifactHandle.writeFile(bytes); await artifactHandle.sync() } finally { await artifactHandle.close() }
  const manifestHandle = await open(tmpManifest, 'w', 0o600)
  try { await manifestHandle.writeFile(JSON.stringify(manifest, null, 2) + '\n'); await manifestHandle.sync() } finally { await manifestHandle.close() }
  await rename(tmpArtifact, artifactPath)
  await rename(tmpManifest, manifestPath)
  return { id, artifactPath, manifestPath, manifest }
}
