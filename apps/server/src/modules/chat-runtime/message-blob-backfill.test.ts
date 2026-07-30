import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parseBlobUrl, readLegacyTruncatedPayload } from '@cradle/chat-runtime-contracts'
import {
  blobs,
  chatMessageBlobRefs,
  chatMessagePayloads,
  databaseMaintenanceTasks,
  messages,
  sessions,
} from '@cradle/db'
import type { UIMessage } from 'ai'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { db, shutdownInfra } from '../../infra'
import { readBlobBytes } from '../blob-store/service'
import type { MaintenanceRunContext } from '../maintenance/service'
import {
  backfillMessageBlobs,
  CHAT_BLOB_BACKFILL_TASK_ID,
} from './message-blob-backfill'
import {
  putMessagePayload,
  toMessageProjectionValues,
} from './message-payload-store'

function restoreEnv(name: string, previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = previousValue
}

async function withTempDataDir<T>(callback: () => Promise<T> | T): Promise<T> {
  const dataDir = mkdtempSync(join(tmpdir(), 'cradle-message-blob-backfill-'))
  const previousDataDir = process.env.CRADLE_DATA_DIR
  const previousDbPath = process.env.CRADLE_DB_PATH
  const previousBatch = process.env.CRADLE_CHAT_BLOB_BACKFILL_BATCH
  const previousMinChars = process.env.CRADLE_CHAT_BLOB_BACKFILL_MIN_ROW_CHARS
  const previousAttachmentFloor = process.env.CRADLE_CHAT_INLINE_ATTACHMENT_MAX_BYTES
  const previousToolLimit = process.env.CRADLE_CHAT_STORED_TOOL_PAYLOAD_MAX_CHARS
  const previousPreviewLimit = process.env.CRADLE_CHAT_STORED_TOOL_PREVIEW_MAX_CHARS
  process.env.CRADLE_DATA_DIR = dataDir
  delete process.env.CRADLE_DB_PATH

  try {
    return await callback()
  }
  finally {
    shutdownInfra()
    rmSync(dataDir, { recursive: true, force: true })
    restoreEnv('CRADLE_DATA_DIR', previousDataDir)
    restoreEnv('CRADLE_DB_PATH', previousDbPath)
    restoreEnv('CRADLE_CHAT_BLOB_BACKFILL_BATCH', previousBatch)
    restoreEnv('CRADLE_CHAT_BLOB_BACKFILL_MIN_ROW_CHARS', previousMinChars)
    restoreEnv('CRADLE_CHAT_INLINE_ATTACHMENT_MAX_BYTES', previousAttachmentFloor)
    restoreEnv('CRADLE_CHAT_STORED_TOOL_PAYLOAD_MAX_CHARS', previousToolLimit)
    restoreEnv('CRADLE_CHAT_STORED_TOOL_PREVIEW_MAX_CHARS', previousPreviewLimit)
  }
}

function seedSession(sessionId: string): void {
  const now = Math.floor(Date.now() / 1000)
  db().insert(sessions).values({
    id: sessionId,
    title: 'Blob Backfill Test',
    titleSource: 'initial',
    runtimeKind: 'standard',
    createdAt: now,
    updatedAt: now,
  }).run()
}

function pngDataUrl(byteLength: number): { url: string, bytes: Buffer } {
  const bytes = Buffer.alloc(byteLength, 0x41)
  return {
    bytes,
    url: `data:image/png;base64,${bytes.toString('base64')}`,
  }
}

function seedStoredMessage(input: {
  sessionId: string
  message: UIMessage
  messageJson?: string
}): { messageId: string, payloadId: string, messageJson: string } {
  const now = Math.floor(Date.now() / 1000)
  const messageJson = input.messageJson ?? JSON.stringify(input.message)
  const source = {
    id: input.message.id,
    sessionId: input.sessionId,
    content: '',
    messageJson,
    errorText: null,
    createdAt: now,
    updatedAt: now,
  }
  putMessagePayload(db(), source)
  db().insert(messages).values(toMessageProjectionValues({
    ...source,
    parentMessageId: null,
    parentToolCallId: null,
    taskId: null,
    depth: 0,
    role: input.message.role === 'assistant' ? 'assistant' : 'user',
    status: 'complete',
  })).run()
  return {
    messageId: input.message.id,
    payloadId: input.message.id,
    messageJson,
  }
}

function openDeadlineContext(
  report: (progress: Parameters<MaintenanceRunContext['report']>[0]) => void = () => {},
): Pick<MaintenanceRunContext, 'deadline' | 'report'> {
  return {
    deadline: Date.now() + 60_000,
    report,
  }
}

function readBackfillTask() {
  return db()
    .select()
    .from(databaseMaintenanceTasks)
    .where(eq(databaseMaintenanceTasks.id, CHAT_BLOB_BACKFILL_TASK_ID))
    .get()
}

describe('message-blob-backfill', () => {
  it('rewrites a pre-seeded 1 MB inline image to reference form, shrinks >10×, and round-trips bytes', async () => {
    await withTempDataDir(async () => {
      const sessionId = randomUUID()
      seedSession(sessionId)
      const { url, bytes } = pngDataUrl(1_048_576)
      const message: UIMessage = {
        id: randomUUID(),
        role: 'user',
        parts: [{ type: 'file', mediaType: 'image/png', url }],
      }
      const seeded = seedStoredMessage({ sessionId, message })
      const beforeLength = seeded.messageJson.length

      const result = await backfillMessageBlobs(openDeadlineContext())

      expect(result.rowsScanned).toBe(1)
      expect(result.rowsRewritten).toBe(1)
      expect(result.blobsWritten).toBe(1)
      expect(result.rowsSkipped).toBe(0)

      const payload = db()
        .select()
        .from(chatMessagePayloads)
        .where(eq(chatMessagePayloads.id, seeded.payloadId))
        .get()
      expect(payload).toBeDefined()
      if (!payload) {
        throw new Error('expected payload')
      }
      expect(payload.messageJson.length * 10).toBeLessThan(beforeLength)
      expect(payload.messageJson).toContain('cradle-blob:')
      expect(payload.messageJson).not.toContain(';base64,')

      const parsed = JSON.parse(payload.messageJson) as UIMessage
      const part = parsed.parts[0]
      expect(part?.type).toBe('file')
      if (part?.type !== 'file') {
        throw new Error('expected file part')
      }
      const blobId = parseBlobUrl(part.url)
      expect(blobId).toBeTruthy()
      if (!blobId) {
        throw new Error('expected blob id')
      }
      const read = await readBlobBytes(blobId)
      expect(Buffer.compare(read.bytes, bytes)).toBe(0)
      expect(db().select().from(blobs).all()).toHaveLength(1)
      expect(db().select().from(chatMessageBlobRefs).all()).toHaveLength(1)
      expect(readBackfillTask()?.status).toBe('completed')
    })
  })

  it('is idempotent: second pass leaves one blob and one ref and reports zero rewrites', async () => {
    await withTempDataDir(async () => {
      const sessionId = randomUUID()
      seedSession(sessionId)
      const { url } = pngDataUrl(1_048_576)
      const message: UIMessage = {
        id: randomUUID(),
        role: 'user',
        parts: [{ type: 'file', mediaType: 'image/png', url }],
      }
      seedStoredMessage({ sessionId, message })

      const first = await backfillMessageBlobs(openDeadlineContext())
      expect(first.rowsRewritten).toBe(1)
      expect(first.blobsWritten).toBe(1)
      expect(readBackfillTask()?.status).toBe('completed')

      const second = await backfillMessageBlobs(openDeadlineContext())
      expect(second.rowsScanned).toBe(0)
      expect(second.rowsRewritten).toBe(0)
      expect(second.blobsWritten).toBe(0)
      expect(db().select().from(blobs).all()).toHaveLength(1)
      expect(db().select().from(chatMessageBlobRefs).all()).toHaveLength(1)
    })
  })

  it('skips a malformed message_json row, counts it, and never writes it back', async () => {
    await withTempDataDir(async () => {
      process.env.CRADLE_CHAT_BLOB_BACKFILL_MIN_ROW_CHARS = '100'
      const sessionId = randomUUID()
      seedSession(sessionId)
      const messageId = randomUUID()
      // Large enough to clear the floor, contains ;base64, so the batch selects it,
      // but is not valid JSON — must not be written back.
      const malformed = `{"not":"json";base64,${'A'.repeat(200)}`
      seedStoredMessage({
        sessionId,
        message: {
          id: messageId,
          role: 'user',
          parts: [{ type: 'text', text: 'placeholder' }],
        },
        messageJson: malformed,
      })

      const result = await backfillMessageBlobs(openDeadlineContext())

      expect(result.rowsScanned).toBe(1)
      expect(result.rowsSkipped).toBe(1)
      expect(result.rowsRewritten).toBe(0)
      const payload = db()
        .select()
        .from(chatMessagePayloads)
        .where(eq(chatMessagePayloads.id, messageId))
        .get()
      expect(payload?.messageJson).toBe(malformed)
      expect(db().select().from(blobs).all()).toHaveLength(0)
      expect(readBackfillTask()?.status).toBe('completed')
    })
  })

  it('respects batch bounding: with more matching rows than the batch size, processes exactly the batch size', async () => {
    await withTempDataDir(async () => {
      process.env.CRADLE_CHAT_BLOB_BACKFILL_BATCH = '2'
      process.env.CRADLE_CHAT_BLOB_BACKFILL_MIN_ROW_CHARS = '1000'
      const sessionId = randomUUID()
      seedSession(sessionId)

      for (let index = 0; index < 3; index += 1) {
        // Distinct bytes so content-addressed putBlob does not collapse the
        // batch into a single blob row and under-count blobsWritten.
        const bytes = Buffer.alloc(8_192, index + 1)
        const url = `data:image/png;base64,${bytes.toString('base64')}`
        seedStoredMessage({
          sessionId,
          message: {
            id: randomUUID(),
            role: 'user',
            parts: [{ type: 'file', mediaType: 'image/png', url }],
          },
        })
      }

      const context = {
        deadline: Date.now() + 60_000,
        report: () => {
          // End the run after the first batch so a second select cannot drain the rest.
          context.deadline = 0
        },
      }

      const result = await backfillMessageBlobs(context)

      expect(result.rowsScanned).toBe(2)
      expect(result.rowsRewritten).toBe(2)
      expect(result.blobsWritten).toBe(2)
      expect(db().select().from(chatMessagePayloads).all()).toHaveLength(3)
      const stillInline = db()
        .select()
        .from(chatMessagePayloads)
        .all()
        .filter(row => row.messageJson.includes(';base64,'))
      expect(stillInline).toHaveLength(1)
      // Interrupted mid-sweep — cursor persisted, not yet completed.
      expect(readBackfillTask()?.status).toBe('pending')
    })
  })

  it('shrinks a legacy truncation marker preview in place without a blob, preserving type and originalChars', async () => {
    await withTempDataDir(async () => {
      process.env.CRADLE_CHAT_BLOB_BACKFILL_MIN_ROW_CHARS = '1000'
      process.env.CRADLE_CHAT_STORED_TOOL_PREVIEW_MAX_CHARS = '4096'
      const sessionId = randomUUID()
      seedSession(sessionId)
      const preview = 'x'.repeat(128_000)
      const originalChars = 900_000
      const message: UIMessage = {
        id: randomUUID(),
        role: 'assistant',
        parts: [{
          type: 'dynamic-tool',
          toolCallId: 'tool-1',
          toolName: 'big-tool',
          state: 'output-available',
          input: { q: 'ok' },
          output: {
            type: 'cradle.truncated-json-payload.v1',
            originalChars,
            preview,
          },
        }],
      } as UIMessage
      const seeded = seedStoredMessage({ sessionId, message })

      const result = await backfillMessageBlobs(openDeadlineContext())

      expect(result.rowsScanned).toBe(1)
      expect(result.rowsRewritten).toBe(1)
      expect(result.blobsWritten).toBe(0)
      expect(db().select().from(blobs).all()).toHaveLength(0)

      const payload = db()
        .select()
        .from(chatMessagePayloads)
        .where(eq(chatMessagePayloads.id, seeded.payloadId))
        .get()
      expect(payload).toBeDefined()
      if (!payload) {
        throw new Error('expected payload')
      }
      expect(payload.messageJson).toContain('cradle.truncated-json-payload.v1')
      expect(payload.messageJson).not.toContain('cradle.blob-payload-ref.v1')
      // Destroyed remainder must not appear — only the original preview prefix.
      expect(payload.messageJson.includes('x'.repeat(128_001))).toBe(false)

      const parsed = JSON.parse(payload.messageJson) as UIMessage
      const part = parsed.parts[0] as { output?: unknown }
      const legacy = readLegacyTruncatedPayload(part.output)
      expect(legacy).not.toBeNull()
      expect(legacy?.originalChars).toBe(originalChars)
      expect(legacy?.preview).toHaveLength(4096)
      expect(legacy?.preview).toBe(preview.slice(0, 4096))
      expect(
        (part.output as { type: string }).type,
      ).toBe('cradle.truncated-json-payload.v1')
    })
  })

  it('matches a large tool-part row with neither marker nor base64 and rewrites it to a blob ref', async () => {
    await withTempDataDir(async () => {
      process.env.CRADLE_CHAT_BLOB_BACKFILL_MIN_ROW_CHARS = '1000'
      process.env.CRADLE_CHAT_STORED_TOOL_PAYLOAD_MAX_CHARS = '128000'
      process.env.CRADLE_CHAT_STORED_TOOL_PREVIEW_MAX_CHARS = '4096'
      const sessionId = randomUUID()
      seedSession(sessionId)
      const output = { body: 'z'.repeat(200_000) }
      // `tool-*` (not dynamic-tool) so the widened LIKE '%"type":"tool-%' arm matches;
      // no ;base64, and no truncation marker.
      const message: UIMessage = {
        id: randomUUID(),
        role: 'assistant',
        parts: [{
          type: 'tool-Bash',
          toolCallId: 'tool-1',
          state: 'output-available',
          input: { q: 'ok' },
          output,
        }],
      } as UIMessage
      const seeded = seedStoredMessage({ sessionId, message })
      expect(seeded.messageJson).not.toContain(';base64,')
      expect(seeded.messageJson).not.toContain('cradle.truncated-json-payload')
      expect(seeded.messageJson).toContain('"type":"tool-Bash"')

      const result = await backfillMessageBlobs(openDeadlineContext())

      expect(result.rowsScanned).toBe(1)
      expect(result.rowsRewritten).toBe(1)
      expect(result.blobsWritten).toBe(1)

      const payload = db()
        .select()
        .from(chatMessagePayloads)
        .where(eq(chatMessagePayloads.id, seeded.payloadId))
        .get()
      expect(payload?.messageJson).toContain('cradle.blob-payload-ref.v1')
      expect(payload?.messageJson.includes('z'.repeat(200_000))).toBe(false)
      expect(db().select().from(blobs).all()).toHaveLength(1)
      expect(db().select().from(chatMessageBlobRefs).all()).toHaveLength(1)
    })
  })

  it('marks the sweep completed when the id cursor is exhausted, then no-ops', async () => {
    await withTempDataDir(async () => {
      process.env.CRADLE_CHAT_BLOB_BACKFILL_MIN_ROW_CHARS = '1000'
      const sessionId = randomUUID()
      seedSession(sessionId)
      const { url } = pngDataUrl(8_192)
      seedStoredMessage({
        sessionId,
        message: {
          id: randomUUID(),
          role: 'user',
          parts: [{ type: 'file', mediaType: 'image/png', url }],
        },
      })

      const first = await backfillMessageBlobs(openDeadlineContext())
      expect(first.rowsRewritten).toBe(1)
      const task = readBackfillTask()
      expect(task?.status).toBe('completed')
      expect(task?.completedAt).toBeTypeOf('number')
      const detail = JSON.parse(task?.detailJson ?? '{}') as {
        maxPayloadIdAtStart: string | null
        cursorPayloadId: string
      }
      expect(detail.maxPayloadIdAtStart).toBeTruthy()
      expect(detail.cursorPayloadId.length).toBeGreaterThan(0)

      const second = await backfillMessageBlobs(openDeadlineContext())
      expect(second).toEqual({
        rowsScanned: 0,
        rowsRewritten: 0,
        blobsWritten: 0,
        bytesReclaimed: 0,
        rowsSkipped: 0,
      })
      expect(readBackfillTask()?.status).toBe('completed')
    })
  })
})
