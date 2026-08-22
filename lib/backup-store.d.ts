export type BackupTrust = 'trusted' | 'invalid' | 'legacy-valid' | 'unverified';
export interface BackupMeta {
    sessionId: string;
    projectKey: string;
    cwd?: string | null;
    maxSeq: number;
    trigger: string;
    validation: Record<string, unknown>;
    kind: string;
    trusted?: boolean;
}
export interface BackupManifest {
    schemaVersion: number;
    sessionId: string;
    projectKey: string;
    cwd: string | null;
    sourcePath: string;
    capturedAt: string;
    trigger: string;
    bytes: number;
    sha256: string;
    maxSeq: number;
    format: string;
    validation: Record<string, unknown>;
    trust: BackupTrust;
}
export interface SavedBackup {
    id: string;
    artifactPath: string;
    manifestPath: string;
    manifest: BackupManifest;
}
export declare function trustFor({ owned, valid }: {
    owned: boolean;
    valid: boolean;
}): BackupTrust;
export declare function manifestFor({ sessionId, projectKey, cwd, sourcePath, bytes, maxSeq, trigger, validation, trusted }: {
    sessionId: string;
    projectKey: string;
    cwd?: string | null;
    sourcePath: string;
    bytes: Buffer;
    maxSeq: number;
    trigger: string;
    validation: Record<string, unknown>;
    trusted?: boolean;
}): BackupManifest;
export declare function backupDirectory(root: string, projectKey: string, sessionId: string): string;
/**
 * Remove single-slot safety backups (pre-repair / pre-restore) for one session,
 * keeping trusted checkpoints. Returns the names of removed manifest files.
 * Auto-cleanup is destructive, so it only targets the slot kinds that repair
 * manages; checkpoint files are never touched here.
 */
export declare function clearSafetySlots(dir: string): Promise<string[]>;
export declare function stableCopy(sourcePath: string, targetDir: string, meta: BackupMeta): Promise<SavedBackup>;
//# sourceMappingURL=backup-store.d.ts.map