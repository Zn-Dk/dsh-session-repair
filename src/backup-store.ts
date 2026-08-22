import { mkdir, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

export type BackupTrust = 'trusted' | 'invalid' | 'legacy-valid' | 'unverified'
export interface BackupMeta {
  sessionId: string
  projectKey: string
  cwd?: string | null
  maxSeq: number
  trigger: string
  validation: Record<string, unknown>
  kind: string
  trusted?: boolean
}
export interface BackupManifest {
  schemaVersion: number
  sessionId: string
  projectKey: string
  cwd: string | null
  sourcePath: string
  capturedAt: string
  trigger: string
  bytes: number
  sha256: string
  maxSeq: number
  format: string
  validation: Record<string, unknown>
  trust: BackupTrust
}
export interface SavedBackup {
  id: string
  artifactPath: string
  manifestPath: string
  manifest: BackupManifest
}

export function trustFor({ owned, valid }: { owned: boolean; valid: boolean }): BackupTrust {
  return owned ? (valid ? 'trusted' : 'invalid') : (valid ? 'legacy-valid' : 'unverified')
}
export function manifestFor({ sessionId, projectKey, cwd, sourcePath, bytes, maxSeq, trigger, validation, trusted }: {
  sessionId: string
  projectKey: string
  cwd?: string | null
  sourcePath: string
  bytes: Buffer
  maxSeq: number
  trigger: string
  validation: Record<string, unknown>
  trusted?: boolean
}): BackupManifest {
  return { schemaVersion: 1, sessionId, projectKey, cwd: cwd ?? null, sourcePath, capturedAt: new Date().toISOString(), trigger, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), maxSeq, format: 'jsonl.zstd', validation, trust: trusted ? 'trusted' : 'unverified' }
}
export function backupDirectory(root: string, projectKey: string, sessionId: string): string {
  return join(root, 'backups', projectKey, sessionId)
}
/**
 * Remove single-slot safety backups (pre-repair / pre-restore) for one session,
 * keeping trusted checkpoints. Returns the names of removed manifest files.
 * Auto-cleanup is destructive, so it only targets the slot kinds that repair
 * manages; checkpoint files are never touched here.
 */
export async function clearSafetySlots(dir: string): Promise<string[]> {
  const removed: string[] = []
  let names: string[]
  try { names = await readdir(dir) } catch { return removed }
  for (const name of names) {
    if (name.startsWith('pre-repair-') || name.startsWith('pre-restore-')) {
      const manifestPath = join(dir, name)
      const artifactPath = manifestPath.slice(0, -'.manifest.json'.length)
      try { await rm(artifactPath) } catch {}
      try { await rm(manifestPath) } catch {}
      removed.push(name)
    }
  }
  return removed
}
export async function stableCopy(sourcePath: string, targetDir: string, meta: BackupMeta): Promise<SavedBackup> {
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
