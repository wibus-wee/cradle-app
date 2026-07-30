import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  isChatBlobPayloadRef,
  parseBlobUrl,
  readLegacyTruncatedPayload,
} from '@cradle/chat-runtime-contracts'
import {
  blobs,
  chatMessageBlobRefs,
  chatMessagePayloads,
  messages,
  sessions,
} from '@cradle/db'
import type { UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'

import { db, shutdownInfra } from '../../infra'
import { readBlobBytes } from '../blob-store/service'
import { projectChatSessionEvent } from './es/projectors'
import {
  externalizeMessageBlobs,
  readPartPayloadRef,
} from './message-blob-externalization'
import { toDurableMessagePayload } from './message-durable-payload'
import { reconstructCradleTurnTranscript } from './transcript'
import { resolveMessageBlobReferences } from './ui-message'

function restoreEnv(name: string, previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = previousValue
}

async function withTempDataDir<T>(callback: () => Promise<T> | T): Promise<T> {
  const dataDir = mkdtempSync(join(tmpdir(), 'cradle-message-blob-ext-'))
  const previousDataDir = process.env.CRADLE_DATA_DIR
  const previousDbPath = process.env.CRADLE_DB_PATH
  const previousAttachmentFloor = process.env.CRADLE_CHAT_INLINE_ATTACHMENT_MAX_BYTES
  const previousToolLimit = process.env.CRADLE_CHAT_STORED_TOOL_PAYLOAD_MAX_CHARS
  const previousPreviewLimit = process.env.CRADLE_CHAT_STORED_TOOL_PREVIEW_MAX_CHARS
  const previousTextLimit = process.env.CRADLE_CHAT_STORED_TEXT_MAX_CHARS
  const previousReasoningLimit = process.env.CRADLE_CHAT_STORED_REASONING_MAX_CHARS
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
    restoreEnv('CRADLE_CHAT_INLINE_ATTACHMENT_MAX_BYTES', previousAttachmentFloor)
    restoreEnv('CRADLE_CHAT_STORED_TOOL_PAYLOAD_MAX_CHARS', previousToolLimit)
    restoreEnv('CRADLE_CHAT_STORED_TOOL_PREVIEW_MAX_CHARS', previousPreviewLimit)
    restoreEnv('CRADLE_CHAT_STORED_TEXT_MAX_CHARS', previousTextLimit)
    restoreEnv('CRADLE_CHAT_STORED_REASONING_MAX_CHARS', previousReasoningLimit)
  }
}

function seedSession(sessionId: string): void {
  const now = Math.floor(Date.now() / 1000)
  db().insert(sessions).values({
    id: sessionId,
    title: 'Blob Externalization Test',
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

function fileMessage(url: string, id = randomUUID()): UIMessage {
  return {
    id,
    role: 'user',
    parts: [{ type: 'file', mediaType: 'image/png', url }],
  }
}

function toolMessage(output: unknown, input?: unknown, id = randomUUID()): UIMessage {
  return {
    id,
    role: 'assistant',
    parts: [{
      type: 'dynamic-tool',
      toolCallId: 'tool-1',
      toolName: 'big-tool',
      state: 'output-available',
      input: input ?? { q: 'ok' },
      output,
    }],
  } as UIMessage
}

describe('message-blob-externalization', () => {
  it('externalizes a data:image/png part above the floor to cradle-blob:// with one blob and file ref', async () => {
    await withTempDataDir(async () => {
      const sessionId = randomUUID()
      seedSession(sessionId)
      const { url } = pngDataUrl(8_192)
      const message = fileMessage(url)

      const result = await externalizeMessageBlobs({ sessionId, message })
      const part = result.parts[0]
      expect(part?.type).toBe('file')
      if (part?.type !== 'file') {
        throw new Error('expected file part')
      }
      expect(parseBlobUrl(part.url)).toBeTruthy()
      expect(db().select().from(blobs).all()).toHaveLength(1)
      const refs = db().select().from(chatMessageBlobRefs).all()
      expect(refs).toHaveLength(1)
      expect(refs[0]).toMatchObject({
        messageId: message.id,
        partPath: '/parts/0/url',
        kind: 'file',
      })
    })
  })

  it('attachment round trip: externalize then resolve restores byte-identical data URL', async () => {
    await withTempDataDir(async () => {
      const sessionId = randomUUID()
      seedSession(sessionId)
      const { url, bytes } = pngDataUrl(16_384)
      const message = fileMessage(url)

      const externalized = await externalizeMessageBlobs({ sessionId, message })
      const resolved = await resolveMessageBlobReferences(externalized)
      const part = resolved.parts[0]
      expect(part?.type).toBe('file')
      if (part?.type !== 'file') {
        throw new Error('expected file part')
      }
      expect(part.url.startsWith('data:image/png;base64,')).toBe(true)
      const roundTripped = Buffer.from(part.url.slice('data:image/png;base64,'.length), 'base64')
      expect(Buffer.compare(roundTripped, bytes)).toBe(0)
    })
  })

  it('shrinks JSON.stringify(result) by at least 10× for a 1 MB inline image', async () => {
    await withTempDataDir(async () => {
      const sessionId = randomUUID()
      seedSession(sessionId)
      const { url } = pngDataUrl(1_000_000)
      const message = fileMessage(url)
      const inputChars = JSON.stringify(message).length

      const result = await externalizeMessageBlobs({ sessionId, message })
      const outputChars = JSON.stringify(result).length

      expect(inputChars / outputChars).toBeGreaterThanOrEqual(10)
    })
  })

  it('keeps a data URL below CRADLE_CHAT_INLINE_ATTACHMENT_MAX_BYTES inline with no rows', async () => {
    await withTempDataDir(async () => {
      process.env.CRADLE_CHAT_INLINE_ATTACHMENT_MAX_BYTES = '4096'
      const sessionId = randomUUID()
      seedSession(sessionId)
      const { url } = pngDataUrl(200)
      const message = fileMessage(url)

      const result = await externalizeMessageBlobs({ sessionId, message })
      expect(result).toBe(message)
      expect(db().select().from(blobs).all()).toHaveLength(0)
      expect(db().select().from(chatMessageBlobRefs).all()).toHaveLength(0)
    })
  })

  it('leaves file:// http:// cradle-asset:// cradle-blob:// urls untouched and returns the same object', async () => {
    await withTempDataDir(async () => {
      const sessionId = randomUUID()
      seedSession(sessionId)
      const message: UIMessage = {
        id: randomUUID(),
        role: 'user',
        parts: [
          { type: 'file', mediaType: 'image/png', url: 'file:///tmp/a.png' },
          { type: 'file', mediaType: 'image/png', url: 'http://example.com/a.png' },
          { type: 'file', mediaType: 'image/png', url: 'cradle-asset://asset-1' },
          { type: 'file', mediaType: 'image/png', url: 'cradle-blob://blob-1' },
        ],
      }

      const result = await externalizeMessageBlobs({ sessionId, message })
      expect(result).toBe(message)
      expect(db().select().from(blobs).all()).toHaveLength(0)
      expect(db().select().from(chatMessageBlobRefs).all()).toHaveLength(0)
    })
  })

  it('two messages with identical image bytes produce two refs and one blobs row', async () => {
    await withTempDataDir(async () => {
      const sessionId = randomUUID()
      seedSession(sessionId)
      const { url } = pngDataUrl(8_192)
      const first = fileMessage(url)
      const second = fileMessage(url)

      await externalizeMessageBlobs({ sessionId, message: first })
      await externalizeMessageBlobs({ sessionId, message: second })

      expect(db().select().from(blobs).all()).toHaveLength(1)
      expect(db().select().from(chatMessageBlobRefs).all()).toHaveLength(2)
    })
  })

  it('externalizes a 900 KB tool output to a blob-payload-ref with preview and tool_output ref', async () => {
    await withTempDataDir(async () => {
      process.env.CRADLE_CHAT_STORED_TOOL_PAYLOAD_MAX_CHARS = '128000'
      process.env.CRADLE_CHAT_STORED_TOOL_PREVIEW_MAX_CHARS = '4096'
      const sessionId = randomUUID()
      seedSession(sessionId)
      const output = { body: 'x'.repeat(900_000) }
      const message = toolMessage(output)

      const result = await externalizeMessageBlobs({ sessionId, message })
      const part = result.parts[0] as { output?: unknown }
      expect(isChatBlobPayloadRef(part.output)).toBe(true)
      if (!isChatBlobPayloadRef(part.output)) {
        throw new Error('expected blob payload ref')
      }
      const json = JSON.stringify(output)
      expect(part.output.originalChars).toBe(json.length)
      expect(part.output.preview).toHaveLength(4096)
      expect(part.output.preview).toBe(json.slice(0, 4096))
      expect(db().select().from(blobs).all()).toHaveLength(1)
      const refs = db().select().from(chatMessageBlobRefs).all()
      expect(refs).toHaveLength(1)
      expect(refs[0]).toMatchObject({
        kind: 'tool_output',
        partPath: '/parts/0/output',
      })
    })
  })

  it('tool payload round trip: blob bytes JSON.parse deep-equals the original output', async () => {
    await withTempDataDir(async () => {
      process.env.CRADLE_CHAT_STORED_TOOL_PAYLOAD_MAX_CHARS = '128000'
      const sessionId = randomUUID()
      seedSession(sessionId)
      const output = { nested: { items: Array.from({ length: 50_000 }, (_, i) => `item-${i}`) } }
      const message = toolMessage(output)

      const result = await externalizeMessageBlobs({ sessionId, message })
      const part = result.parts[0] as { output?: unknown }
      if (!isChatBlobPayloadRef(part.output)) {
        throw new Error('expected blob payload ref')
      }
      const { bytes } = await readBlobBytes(part.output.blobId)
      expect(JSON.parse(bytes.toString('utf8'))).toEqual(output)
    })
  })

  it('oversized input and output on one part produce two refs with distinct partPaths', async () => {
    await withTempDataDir(async () => {
      process.env.CRADLE_CHAT_STORED_TOOL_PAYLOAD_MAX_CHARS = '1000'
      const sessionId = randomUUID()
      seedSession(sessionId)
      const big = { body: 'y'.repeat(5_000) }
      const message = toolMessage(big, big)

      await externalizeMessageBlobs({ sessionId, message })
      const refs = db().select().from(chatMessageBlobRefs).all()
      expect(refs).toHaveLength(2)
      const paths = refs.map(ref => ref.partPath).sort()
      expect(paths).toEqual(['/parts/0/input', '/parts/0/output'])
    })
  })

  it('leaves a small tool payload untouched with no rows', async () => {
    await withTempDataDir(async () => {
      const sessionId = randomUUID()
      seedSession(sessionId)
      const message = toolMessage({ ok: true })

      const result = await externalizeMessageBlobs({ sessionId, message })
      expect(result).toBe(message)
      expect(db().select().from(blobs).all()).toHaveLength(0)
      expect(db().select().from(chatMessageBlobRefs).all()).toHaveLength(0)
    })
  })

  it('running externalization twice on the same message inserts one ref, not two', async () => {
    await withTempDataDir(async () => {
      const sessionId = randomUUID()
      seedSession(sessionId)
      const { url } = pngDataUrl(8_192)
      const message = fileMessage(url)

      const first = await externalizeMessageBlobs({ sessionId, message })
      const second = await externalizeMessageBlobs({ sessionId, message: first })

      expect(second).toBe(first)
      expect(db().select().from(chatMessageBlobRefs).all()).toHaveLength(1)
      expect(db().select().from(blobs).all()).toHaveLength(1)
    })
  })

  it('moves an existing part ref when the same checkpoint part changes', async () => {
    await withTempDataDir(async () => {
      const sessionId = randomUUID()
      const messageId = randomUUID()
      seedSession(sessionId)
      const first = externalizeMessageBlobs({
        sessionId,
        message: fileMessage(pngDataUrl(8_192).url, messageId),
      })
      const second = externalizeMessageBlobs({
        sessionId,
        message: fileMessage(pngDataUrl(9_216).url, messageId),
      })
      const firstBlobId = parseBlobUrl((first.parts[0] as { url: string }).url)
      const secondBlobId = parseBlobUrl((second.parts[0] as { url: string }).url)

      expect(secondBlobId).not.toBe(firstBlobId)
      expect(db().select().from(chatMessageBlobRefs).all()).toEqual([
        expect.objectContaining({
          messageId,
          partPath: '/parts/0/url',
          blobId: secondBlobId,
        }),
      ])
    })
  })

  it('releases a checkpoint ref when the final part no longer needs externalization', async () => {
    await withTempDataDir(async () => {
      process.env.CRADLE_CHAT_STORED_TOOL_PAYLOAD_MAX_CHARS = '100'
      const sessionId = randomUUID()
      const messageId = randomUUID()
      seedSession(sessionId)

      externalizeMessageBlobs({
        sessionId,
        message: toolMessage({ body: 'x'.repeat(1_000) }, undefined, messageId),
      })
      expect(db().select().from(chatMessageBlobRefs).all()).toHaveLength(1)

      const final = toolMessage({ body: 'small' }, undefined, messageId)
      expect(externalizeMessageBlobs({ sessionId, message: final })).toBe(final)
      expect(db().select().from(chatMessageBlobRefs).all()).toHaveLength(0)
      expect(db().select().from(blobs).all()).toHaveLength(1)
    })
  })

  it('losslessly externalizes checkpoint screenshots and changing tool output', async () => {
    await withTempDataDir(async () => {
      process.env.CRADLE_CHAT_STORED_TOOL_PAYLOAD_MAX_CHARS = '100'
      const sessionId = randomUUID()
      seedSession(sessionId)
      const { url } = pngDataUrl(1_000_000)
      const message = {
        id: randomUUID(),
        role: 'assistant',
        parts: [
          { type: 'file', mediaType: 'image/png', url },
          {
            type: 'dynamic-tool',
            toolCallId: 'tool-1',
            toolName: 'streaming-tool',
            state: 'output-available',
            input: {},
            output: { body: 'x'.repeat(200_000) },
          },
        ],
      } as UIMessage

      const checkpoint = externalizeMessageBlobs({ sessionId, message })
      const checkpointJson = JSON.stringify(checkpoint)
      expect(checkpointJson).not.toContain(url)
      expect(checkpointJson).not.toContain('x'.repeat(200_000))
      expect(checkpointJson.length).toBeLessThan(10_000)
      expect(parseBlobUrl((checkpoint.parts[0] as { url: string }).url)).toBeTruthy()
      expect(isChatBlobPayloadRef((checkpoint.parts[1] as { output: unknown }).output)).toBe(true)
      expect(db().select().from(chatMessageBlobRefs).all()).toHaveLength(2)
      await expect(resolveMessageBlobReferences(checkpoint)).resolves.toEqual(message)
    })
  })

  it('budgets transcript characters after provider blob resolution', async () => {
    await withTempDataDir(async () => {
      process.env.CRADLE_CHAT_STORED_TOOL_PAYLOAD_MAX_CHARS = '100'
      process.env.CRADLE_CHAT_STORED_TOOL_PREVIEW_MAX_CHARS = '10'
      const sessionId = randomUUID()
      seedSession(sessionId)
      const message = toolMessage({ body: 'z'.repeat(10_000) })
      const stored = externalizeMessageBlobs({ sessionId, message })

      const transcript = await reconstructCradleTurnTranscript({
        rows: [{
          id: message.id,
          role: 'assistant',
          content: '',
          messageJson: JSON.stringify(stored),
          createdAt: 1,
        }],
        excludedMessageIds: new Set(),
        maxMessages: 1,
        maxChars: 500,
      })

      expect(transcript.truncated).toBe(true)
      expect(JSON.stringify(transcript.history)).not.toContain('z'.repeat(1_000))
      expect(JSON.stringify(transcript.history)).toContain('Cradle transcript part omitted')
    })
  })

  it('durable message_json for a 900 KB tool output is under ~10 KB and has no truncation marker', async () => {
    await withTempDataDir(async () => {
      process.env.CRADLE_CHAT_STORED_TOOL_PAYLOAD_MAX_CHARS = '128000'
      process.env.CRADLE_CHAT_STORED_TOOL_PREVIEW_MAX_CHARS = '4096'
      const sessionId = randomUUID()
      seedSession(sessionId)
      const message = toolMessage({ body: 'z'.repeat(900_000) })

      const durable = await toDurableMessagePayload({ sessionId, message })
      expect(durable.messageJson.length).toBeLessThan(10_000)
      expect(durable.messageJson).not.toContain('cradle.truncated-json-payload')
      expect(durable.messageJson).toContain('cradle.blob-payload-ref.v1')
    })
  })

  it('routes plan implementation approval projection through the durable seam', async () => {
    await withTempDataDir(async () => {
      process.env.CRADLE_CHAT_STORED_TOOL_PAYLOAD_MAX_CHARS = '100'
      const sessionId = randomUUID()
      const messageId = randomUUID()
      const approvalId = 'implement-plan:tool-1'
      const now = Math.floor(Date.now() / 1000)
      seedSession(sessionId)
      const planContent = 'step '.repeat(20_000)
      const message = {
        id: messageId,
        role: 'assistant',
        parts: [{
          type: 'dynamic-tool',
          toolCallId: approvalId,
          toolName: 'plan_implementation',
          state: 'approval-requested',
          input: { planContent },
          approval: { id: approvalId },
        }],
      } as UIMessage
      db().insert(chatMessagePayloads).values({
        id: messageId,
        sessionId,
        content: '',
        messageJson: JSON.stringify(message),
        createdAt: now,
        updatedAt: now,
      }).run()
      db().insert(messages).values({
        id: messageId,
        sessionId,
        role: 'assistant',
        status: 'complete',
        payloadId: messageId,
        createdAt: now,
        updatedAt: now,
      }).run()

      db().transaction((tx) => {
        projectChatSessionEvent(tx, {
          type: 'PlanImplementationResponded',
          payload: {
            sessionId,
            messageId,
            approvalId,
            approved: true,
            updatedAt: now + 1,
          },
        })
      })

      const stored = db().select().from(chatMessagePayloads).get()
      const storedMessage = JSON.parse(stored!.messageJson) as UIMessage
      const storedPart = storedMessage.parts[0] as {
        approval?: { approved?: boolean }
        input?: unknown
      }
      expect(storedPart.approval?.approved).toBe(true)
      expect(isChatBlobPayloadRef(storedPart.input)).toBe(true)
      expect(stored!.messageJson).not.toContain(planContent)
      expect(db().select().from(chatMessageBlobRefs).all()).toHaveLength(1)
    })
  })

  it('externalizes text overflow under the shared message budget and keeps a recoverable prefix', async () => {
    await withTempDataDir(async () => {
      process.env.CRADLE_CHAT_STORED_TEXT_MAX_CHARS = '100'
      process.env.CRADLE_CHAT_STORED_TOOL_PREVIEW_MAX_CHARS = '32'
      const sessionId = randomUUID()
      seedSession(sessionId)
      const fullText = 'a'.repeat(250)
      const message: UIMessage = {
        id: randomUUID(),
        role: 'assistant',
        parts: [{ type: 'text', text: fullText }],
      }

      const result = await externalizeMessageBlobs({ sessionId, message })
      const part = result.parts[0]
      expect(part?.type).toBe('text')
      if (part?.type !== 'text') {
        throw new Error('expected text part')
      }
      expect(part.text).toBe(fullText.slice(0, 100))
      expect(part.text).toHaveLength(100)
      const ref = readPartPayloadRef(part)
      expect(ref).not.toBeNull()
      expect(ref?.originalChars).toBe(250)
      expect(ref?.preview).toHaveLength(32)
      expect(ref?.mediaType).toBe('text/plain')
      const refs = db().select().from(chatMessageBlobRefs).all()
      expect(refs).toHaveLength(1)
      expect(refs[0]).toMatchObject({
        kind: 'text',
        partPath: '/parts/0/text',
      })
      if (!ref) {
        throw new Error('expected payload ref')
      }
      const { bytes } = await readBlobBytes(ref.blobId)
      expect(bytes.toString('utf8')).toBe(fullText)
    })
  })

  it('text overflow round trip: resolve restores the full original prose for provider input', async () => {
    await withTempDataDir(async () => {
      process.env.CRADLE_CHAT_STORED_TEXT_MAX_CHARS = '50'
      const sessionId = randomUUID()
      seedSession(sessionId)
      const fullText = 'provider-must-see-every-character-'.repeat(10)
      const message: UIMessage = {
        id: randomUUID(),
        role: 'assistant',
        parts: [{ type: 'text', text: fullText }],
      }

      const externalized = await externalizeMessageBlobs({ sessionId, message })
      const resolved = await resolveMessageBlobReferences(externalized)
      const part = resolved.parts[0]
      expect(part?.type).toBe('text')
      if (part?.type !== 'text') {
        throw new Error('expected text part')
      }
      expect(part.text).toBe(fullText)
      expect(readPartPayloadRef(part)).toBeNull()
      expect(JSON.stringify(resolved)).not.toContain('payloadRef')
      expect(JSON.stringify(resolved)).not.toContain('cradle.blob-payload-ref.v1')
    })
  })

  it('shared text budget across parts externalizes later overflow instead of erasing it', async () => {
    await withTempDataDir(async () => {
      process.env.CRADLE_CHAT_STORED_TEXT_MAX_CHARS = '100'
      const sessionId = randomUUID()
      seedSession(sessionId)
      const first = '1'.repeat(80)
      const second = '2'.repeat(80)
      const message: UIMessage = {
        id: randomUUID(),
        role: 'assistant',
        parts: [
          { type: 'text', text: first },
          { type: 'text', text: second },
        ],
      }

      const result = await externalizeMessageBlobs({ sessionId, message })
      expect(result.parts[0]).toMatchObject({ type: 'text', text: first })
      expect(readPartPayloadRef(result.parts[0]!)).toBeNull()
      const secondPart = result.parts[1]
      expect(secondPart?.type).toBe('text')
      if (secondPart?.type !== 'text') {
        throw new Error('expected second text part')
      }
      // 20 chars of budget remain — keep those inline, never a bare empty string.
      expect(secondPart.text).toBe(second.slice(0, 20))
      expect(secondPart.text.length).toBe(20)
      const ref = readPartPayloadRef(secondPart)
      expect(ref?.originalChars).toBe(80)
      if (!ref) {
        throw new Error('expected payload ref on second part')
      }
      const { bytes } = await readBlobBytes(ref.blobId)
      expect(bytes.toString('utf8')).toBe(second)
    })
  })

  it('exhausted text budget still stores a recoverable blob instead of an empty erased part', async () => {
    await withTempDataDir(async () => {
      process.env.CRADLE_CHAT_STORED_TEXT_MAX_CHARS = '10'
      const sessionId = randomUUID()
      seedSession(sessionId)
      const message: UIMessage = {
        id: randomUUID(),
        role: 'assistant',
        parts: [
          { type: 'text', text: '0123456789' },
          { type: 'text', text: 'OVERFLOW-FULL-TEXT' },
        ],
      }

      const result = await externalizeMessageBlobs({ sessionId, message })
      const secondPart = result.parts[1]
      expect(secondPart?.type).toBe('text')
      if (secondPart?.type !== 'text') {
        throw new Error('expected second text part')
      }
      expect(secondPart.text).toBe('')
      const ref = readPartPayloadRef(secondPart)
      expect(ref).not.toBeNull()
      if (!ref) {
        throw new Error('expected payload ref')
      }
      const { bytes } = await readBlobBytes(ref.blobId)
      expect(bytes.toString('utf8')).toBe('OVERFLOW-FULL-TEXT')
    })
  })
})

describe('transient truncation stays off the durable path', () => {
  it('bounds a snapshot payload for observability while the durable path keeps the bytes', async () => {
    const { truncateSnapshotPayload } = await import('./message-snapshot-compaction')
    const bounded = truncateSnapshotPayload({ body: 'w'.repeat(200_000) })
    expect(isChatBlobPayloadRef(bounded)).toBe(false)
    expect(readLegacyTruncatedPayload(bounded)).not.toBeNull()
  })
})
