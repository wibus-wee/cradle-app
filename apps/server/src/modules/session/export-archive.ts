// FILE: export-archive.ts
// Purpose: Build a ZIP archive that exports a single Cradle session so a user
//          can download the conversation as a portable, compressed package.
// Layer: Session module utility (plain async module; the HTTP route composes it
//          through a streamed response). ZIP is produced with node:zlib and a
//          hand-written central directory. Entries are serialized and deflated
//          incrementally (per-message chunks through a streaming deflater with a
//          running CRC), so the server never materializes a full entry string
//          or uncompressed buffer - peak memory is bounded by the compressed
//          bytes of one entry.
// Exports: sessionArchiveChunks, buildSessionArchiveBytes, sessionArchiveFileName,
//          threadExportBlockedReason.
// Ported from synara's exportThreadArchive.ts, adapted to Cradle's session model.

import zlib from 'node:zlib'

export interface ArchiveMessage {
  readonly id: string
  readonly role: 'user' | 'assistant'
  readonly status: string
  readonly content: string
  readonly createdAt: number
  readonly updatedAt: number
}

export interface SessionArchiveUsage {
  readonly totalTokens: number
  readonly promptTokens: number
  readonly completionTokens: number
  readonly turnCount: number
}

export interface SessionArchive {
  readonly sessionId: string
  readonly title: string
  readonly modelId: string | null
  readonly providerTargetId: string | null
  readonly createdAt: number
  readonly updatedAt: number
  readonly usage: SessionArchiveUsage
  readonly messages: readonly ArchiveMessage[]
}

export interface SessionArchiveEntry {
  readonly name: string
  readonly chunks: Iterable<string>
}

const u16 = (value: number): Buffer => {
  const buffer = Buffer.alloc(2)
  buffer.writeUInt16LE(value >>> 0, 0)
  return buffer
}

const u32 = (value: number): Buffer => {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32LE(value >>> 0, 0)
  return buffer
}

const UTF8_FLAG = 0x0800

interface DeflatedEntryData {
  readonly compressed: Buffer
  readonly crc: number
  readonly uncompressedSize: number
}

// Streams entry chunks through a raw deflater while keeping a running CRC-32,
// so only the compressed bytes are retained (needed up front: the ZIP local
// header stores the compressed size and CRC before the payload).
async function deflateEntryChunks(chunks: Iterable<string>): Promise<DeflatedEntryData> {
  const deflater = zlib.createDeflateRaw()
  const compressedChunks: Buffer[] = []
  deflater.on('data', (chunk: Buffer) => compressedChunks.push(chunk))
  const finished = new Promise<void>((resolve, reject) => {
    deflater.once('end', resolve)
    deflater.once('error', reject)
  })

  let crc = 0
  let uncompressedSize = 0
  for (const chunk of chunks) {
    const buffer = Buffer.from(chunk, 'utf8')
    crc = zlib.crc32(buffer, crc) >>> 0
    uncompressedSize += buffer.length
    if (!deflater.write(buffer)) {
      await new Promise<void>(resolve => deflater.once('drain', resolve))
    }
  }
  deflater.end()
  await finished

  return { compressed: Buffer.concat(compressedChunks), crc, uncompressedSize }
}

interface ZipEntryRecord {
  readonly localChunk: Buffer
  readonly centralRecord: (offset: number) => Buffer
}

// Zeroed DOS time/date (1980-01-01 00:00) keeps exports deterministic without
// adding date conversion code to the archive writer. Entries are always
// deflated: text transcripts compress well, and tiny entries stay valid ZIP
// even when deflate adds a few bytes.
async function buildZipEntry(entry: SessionArchiveEntry): Promise<ZipEntryRecord> {
  const nameBuffer = Buffer.from(entry.name, 'utf8')
  const { compressed, crc, uncompressedSize } = await deflateEntryChunks(entry.chunks)
  const method = 8

  const localChunk = Buffer.concat([
    u32(0x04034B50), // local file header signature
    u16(20), // version needed to extract
    u16(UTF8_FLAG), // general purpose: UTF-8 names
    u16(method), // compression method (8 deflate)
    u16(0), // last mod time
    u16(0), // last mod date
    u32(crc), // CRC-32
    u32(compressed.length), // compressed size
    u32(uncompressedSize), // uncompressed size
    u16(nameBuffer.length), // file name length
    u16(0), // extra field length
    nameBuffer,
    compressed,
  ])

  const centralRecord = (offset: number): Buffer =>
    Buffer.concat([
      u32(0x02014B50), // central directory header signature
      u16(20), // version made by
      u16(20), // version needed to extract
      u16(UTF8_FLAG), // general purpose: UTF-8 names
      u16(method), // compression method
      u16(0), // last mod time
      u16(0), // last mod date
      u32(crc), // CRC-32
      u32(compressed.length), // compressed size
      u32(uncompressedSize), // uncompressed size
      u16(nameBuffer.length), // file name length
      u16(0), // extra field length
      u16(0), // file comment length
      u16(0), // disk number start
      u16(0), // internal file attributes
      u32(0), // external file attributes
      u32(offset), // offset of local header
      nameBuffer,
    ])

  return { localChunk, centralRecord }
}

const MESSAGE_ROLE_HEADING: Record<string, string> = {
  user: 'User',
  assistant: 'Assistant',
}

// One chunk for the header, then one chunk per message; nothing accumulates.
// Reuses the verbatim markdown transcript shape (code fences preserved as-is).
function* transcriptMarkdownChunks(archive: SessionArchive): Generator<string> {
  const created = new Date(archive.createdAt * 1000).toISOString()
  yield `# ${archive.title}\n\n> Exported from Cradle · ${created}\n`
  if (archive.modelId) {
    yield `\n> Model: ${archive.modelId}\n`
  }
  for (const message of archive.messages) {
    const heading = MESSAGE_ROLE_HEADING[message.role] ?? 'Message'
    const ts = new Date(message.createdAt * 1000).toISOString()
    yield `\n## ${heading} \`${ts}\`\n\n${message.content}\n`
  }
}

function exportMessageProjection(message: ArchiveMessage): Record<string, unknown> {
  return {
    id: message.id,
    role: message.role,
    status: message.status,
    content: message.content,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
  }
}

// Emits the session metadata object once, then appends the messages array one
// serialized message at a time so the full JSON document never exists as a
// single string.
function* sessionJsonChunks(archive: SessionArchive): Generator<string> {
  const metadata = JSON.stringify(
    {
      session: {
        id: archive.sessionId,
        title: archive.title,
        modelId: archive.modelId,
        providerTargetId: archive.providerTargetId,
        createdAt: archive.createdAt,
        updatedAt: archive.updatedAt,
      },
      usage: archive.usage,
    },
    null,
    2,
  )
  // Drop the closing "\n}" so the messages array can be appended incrementally.
  yield `${metadata.slice(0, -2)},\n  "messages": [`

  let first = true
  for (const message of archive.messages) {
    const messageJson = JSON.stringify(exportMessageProjection(message), null, 2)
      .split('\n')
      .map(line => `    ${line}`)
      .join('\n')
    yield `${first ? '' : ','}\n${messageJson}`
    first = false
  }

  yield '\n  ]\n}'
}

function sessionArchiveEntries(archive: SessionArchive): SessionArchiveEntry[] {
  return [
    { name: 'session.json', chunks: sessionJsonChunks(archive) },
    { name: 'transcript.md', chunks: transcriptMarkdownChunks(archive) },
  ]
}

// Streams the ZIP as it is produced: one local header+payload chunk per entry,
// then the central directory and end record.
export async function* sessionArchiveChunks(archive: SessionArchive): AsyncGenerator<Buffer> {
  const centralRecords: Buffer[] = []
  let offset = 0
  let entryCount = 0

  for (const entry of sessionArchiveEntries(archive)) {
    const { localChunk, centralRecord } = await buildZipEntry(entry)
    centralRecords.push(centralRecord(offset))
    offset += localChunk.length
    entryCount += 1
    yield localChunk
  }

  const centralDirectoryBody = Buffer.concat(centralRecords)
  yield centralDirectoryBody

  yield Buffer.concat([
    u32(0x06054B50), // end of central directory signature
    u16(0), // number of this disk
    u16(0), // disk where central directory starts
    u16(entryCount), // entries on this disk
    u16(entryCount), // total entries
    u32(centralDirectoryBody.length), // size of central directory
    u32(offset), // offset of central directory
    u16(0), // comment length
  ])
}

// Convenience for tests and small callers that want the whole archive at once.
export async function buildSessionArchiveBytes(archive: SessionArchive): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of sessionArchiveChunks(archive)) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

const FILENAME_SAFE_REPLACE = /[^a-z0-9-]+/g

function slugifyTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .trim()
    .replace(FILENAME_SAFE_REPLACE, '-')
    .replace(/^-+|-+$/g, '')
  return slug.length > 0 ? slug.slice(0, 48) : 'session'
}

// Stable date bucket derived from the epoch seconds keeps filenames sortable
// without pulling in a date library for formatting.
export function sessionArchiveFileName(input: {
  readonly title: string
  readonly createdAtEpochSeconds: number
}): string {
  const date = new Date(input.createdAtEpochSeconds * 1000)
  const dateBucket = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`
  return `cradle-session-${slugifyTitle(input.title)}-${dateBucket}.zip`
}

// Export-eligibility guard shared by the HTTP route (409) and the web trigger so
// the two cannot drift. A session is blocked while any message is still
// streaming - exporting a partial/in-flight response would produce a misleading
// transcript.
export function threadExportBlockedReason(messages: readonly { status: string }[]): string | null {
  if (messages.some(message => message.status === 'streaming')) {
    return 'Session is still streaming. Wait for the current response to finish before exporting.'
  }
  return null
}
