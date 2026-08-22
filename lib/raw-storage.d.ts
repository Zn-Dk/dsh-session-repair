export interface ZstdFrame {
    start: number;
    end: number;
}
export interface DecodedJsonl {
    frames: ZstdFrame[];
    frameEvents: unknown[][];
    events: unknown[];
}
export interface ArtifactFingerprint {
    bytes: number;
    sha256: string;
    mtimeMs: number;
}
export interface Artifact {
    path: string;
    stable: boolean;
    fingerprint: ArtifactFingerprint;
    bytes: Buffer;
    frames: ZstdFrame[];
    frameEvents: unknown[][];
    events: unknown[];
}
export declare function scanFrames(buffer: Buffer): ZstdFrame[];
export declare function decodeJsonl(buffer: Buffer): DecodedJsonl;
export declare function readArtifact(path: string): Promise<Artifact>;
//# sourceMappingURL=raw-storage.d.ts.map