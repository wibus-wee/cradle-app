import { afterEach, describe, expect, it } from 'vitest'

import type { ArchiveMessage, SessionArchive } from './export-archive'
import {
  buildSessionArchiveBytes,
  sessionArchiveFileName,
  threadExportBlockedReason,
} from './export-archive'

function buildArchive(overrides: Partial<SessionArchive> = {}): SessionArchive {
  const messages: ArchiveMessage[] = [
    {
      id: 'm1',
      role: 'user',
      status: 'complete',
      content: 'Hello world',
      createdAt: 1_700_000_000,
      updatedAt: 1_700_000_010,
    },
    {
      id: 'm2',
      role: 'assistant',
      status: 'complete',
      content: 'Hi there!\n\n```ts\nconst x = 1\n```',
      createdAt: 1_700_000_020,
      updatedAt: 1_700_000_030,
    },
  ]
  return {
    sessionId: 'session-1',
    title: 'My Cradle Session',
    modelId: 'claude-sonnet-5',
    providerTargetId: null,
    createdAt: 1_700_000_000,
    updatedAt: 1_700_000_030,
    usage: { totalTokens: 1234, promptTokens: 100, completionTokens: 1134, turnCount: 2 },
    messages,
    ...overrides,
  }
}

// Minimal ZIP reader: parses the central directory to locate entries, then
// reads + inflates each local payload. Good enough to verify the writer round
// trips without pulling in a zip dependency.
interface ZipEntry {
  name: string
  data: Buffer
}

async function readZip(buffer: Buffer): Promise<ZipEntry[]> {
  const { crc32, inflateRawSync } = await import('node:zlib')
  const entries: ZipEntry[] = []
  // End-of-central-directory record signature.
  const eocd = buffer.indexOf(Buffer.from([0x50, 0x4B, 0x05, 0x06]))
  expect(eocd).toBeGreaterThan(-1)
  const cdOffset = buffer.readUInt32LE(eocd + 16)
  const cdSize = buffer.readUInt32LE(eocd + 12)
  const cdEnd = cdOffset + cdSize

  let cursor = cdOffset
  while (cursor < cdEnd) {
    const signature = buffer.readUInt32LE(cursor)
    if (signature !== 0x02014B50) {
      break
    }
    const crc = buffer.readUInt32LE(cursor + 16)
    const compressedSize = buffer.readUInt32LE(cursor + 20)
    const uncompressedSize = buffer.readUInt32LE(cursor + 24)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42)
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8')

    // Resolve the compressed payload from the local file header.
    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28)
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize)
    const method = buffer.readUInt16LE(cursor + 10)
    const data = method === 0 ? compressed : inflateRawSync(compressed)

    expect(data.length).toBe(uncompressedSize)
    expect(crc32(data) >>> 0).toBe(crc)

    entries.push({ name, data })
    cursor += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

describe('session export archive', () => {
  afterEach(() => {
    // No global state; placeholder for symmetry with other module tests.
  })

  it('packs session.json and transcript.md with verbatim content', async () => {
    const archive = buildArchive()
    const bytes = await buildSessionArchiveBytes(archive)
    const entries = await readZip(bytes)
    const byName = new Map(entries.map(entry => [entry.name, entry.data.toString('utf8')]))

    expect(entries.map(entry => entry.name).sort()).toEqual(['session.json', 'transcript.md'])

    const json = JSON.parse(byName.get('session.json')!)
    expect(json.session.id).toBe('session-1')
    expect(json.session.title).toBe('My Cradle Session')
    expect(json.session.modelId).toBe('claude-sonnet-5')
    expect(json.usage.totalTokens).toBe(1234)
    expect(json.messages).toHaveLength(2)
    expect(json.messages[0]).toMatchObject({ role: 'user', content: 'Hello world' })
    expect(json.messages[1]).toMatchObject({ role: 'assistant', status: 'complete' })

    const md = byName.get('transcript.md')!
    expect(md).toContain('# My Cradle Session')
    expect(md).toContain('## User')
    expect(md).toContain('Hello world')
    expect(md).toContain('## Assistant')
    // Code fences are preserved verbatim - no escaping.
    expect(md).toContain('```ts\nconst x = 1\n```')
  })

  it('produces a deterministic, slug-stamped filename', () => {
    const name = sessionArchiveFileName({
      title: 'My Cradle Session',
      createdAtEpochSeconds: 1_700_000_000,
    })
    // 2023-11-14 UTC
    expect(name).toBe('cradle-session-my-cradle-session-20231114.zip')
  })

  it('falls back to "session" when the title has no slug-safe characters', () => {
    const name = sessionArchiveFileName({
      title: '   !!!   ',
      createdAtEpochSeconds: 1_700_000_000,
    })
    expect(name).toBe('cradle-session-session-20231114.zip')
  })

  it('blocks export while any message is streaming', () => {
    expect(threadExportBlockedReason([{ status: 'complete' }, { status: 'streaming' }])).not.toBeNull()
    expect(threadExportBlockedReason([{ status: 'complete' }, { status: 'aborted' }])).toBeNull()
  })
})
