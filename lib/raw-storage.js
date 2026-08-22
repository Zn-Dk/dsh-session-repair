import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { zstdDecompressSync } from 'node:zlib'

function frameEnd(buffer, start) {
  let i = start + 4
  const descriptor = buffer[i++]
  if (descriptor === undefined) throw new Error('truncated zstd descriptor')
  const single = Boolean(descriptor & 0x20)
  const checksum = Boolean(descriptor & 0x04)
  const dictionary = descriptor & 3
  i += single ? 0 : 1
  i += dictionary === 0 ? 0 : dictionary === 1 ? 1 : dictionary === 2 ? 2 : 4
  const flag = descriptor >>> 6
  i += flag === 0 ? single ? 1 : 0 : flag === 1 ? 2 : flag === 2 ? 4 : 8
  while (true) {
    if (i + 3 > buffer.length) throw new Error('truncated zstd block header')
    const header = buffer[i] | (buffer[i + 1] << 8) | (buffer[i + 2] << 16)
    i += 3 + (header >>> 3)
    if (i > buffer.length) throw new Error('truncated zstd block')
    if (header & 1) return i + (checksum ? 4 : 0)
  }
}

export function scanFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    if (offset + 4 > buffer.length || buffer.readUInt32LE(offset) !== 0xfd2fb528) throw new Error('invalid zstd magic')
    const end = frameEnd(buffer, offset)
    if (end > buffer.length) throw new Error('truncated zstd checksum')
    frames.push({ start: offset, end })
    offset = end
  }
  return frames
}

export function decodeJsonl(buffer) {
  const frames = scanFrames(buffer)
  const lines = []
  const frameEvents = []
  for (const frame of frames) {
    const events = []
    const text = zstdDecompressSync(buffer.subarray(frame.start, frame.end)).toString()
    for (const line of text.split('\n')) if (line.trim() !== '') {
      const event = JSON.parse(line)
      lines.push(event)
      events.push(event)
    }
    frameEvents.push(events)
  }
  return { frames, frameEvents, events: lines }
}

export async function readArtifact(path) {
  const first = await stat(path)
  const bytes = await readFile(path)
  const second = await stat(path)
  const stable = first.size === second.size && first.mtimeMs === second.mtimeMs && first.ino === second.ino && first.size === bytes.length
  const fingerprint = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), mtimeMs: second.mtimeMs }
  if (!stable) return { path, stable: false, fingerprint, bytes, events: [], frames: [] }
  const decoded = decodeJsonl(bytes)
  return { path, stable: true, fingerprint, bytes, ...decoded }
}
