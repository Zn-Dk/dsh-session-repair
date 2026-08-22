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
export declare function stableCopy(sourcePath: string, targetDir: string, meta: BackupMeta): Promise<SavedBackup>;
//# sourceMappingURL=backup-store.d.ts.map