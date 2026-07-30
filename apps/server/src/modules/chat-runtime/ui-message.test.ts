import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ChatBlobPayloadRef } from '@cradle/chat-runtime-contracts'
import {
  formatBlobUrl,
} from '@cradle/chat-runtime-contracts'
import type { UIMessage } from 'ai'
import { afterEach, describe, expect, it } from 'vitest'

import { db, shutdownInfra } from '../../infra'
import { putBlob } from '../blob-store/service'
import {
  normalizeMessageSnapshot,
  projectLightOcrMessage,
  projectProviderInputMessage,
  resolveMessageBlobReferences,
} from './ui-message'

function restoreEnv(name: string, previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = previousValue
}

async function withTempDataDir<T>(callback: () => Promise<T> | T): Promise<T> {
  const dataDir = mkdtempSync(join(tmpdir(), 'cradle-ui-message-blob-'))
  const previousDataDir = process.env.CRADLE_DATA_DIR
  const previousDbPath = process.env.CRADLE_DB_PATH
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
  }
}

describe('normalizeMessageSnapshot', () => {
  it('removes attachment payloads from legacy steer split metadata', () => {
    const imageUrl = 'data:image/png;base64,large-image-payload'
    const message = {
      id: 'steer-1',
      role: 'user',
      parts: [{ type: 'text', text: 'Please adjust.' }],
      metadata: {
        cradle: {
          continuation: {
            mode: 'steer',
            sourceMessageId: 'assistant-1',
            splitParts: [
              {
                type: 'file',
                mediaType: 'image/png',
                url: imageUrl,
              },
              { type: 'text', text: 'Before steer.' },
            ],
          },
        },
      },
    } as UIMessage

    const normalized = normalizeMessageSnapshot(message)

    expect(normalized.metadata).toEqual({
      cradle: {
        continuation: {
          mode: 'steer',
          sourceMessageId: 'assistant-1',
          splitParts: [
            { type: 'file' },
            { type: 'text', text: 'Before steer.' },
          ],
        },
      },
    })
    expect(JSON.stringify(normalized.metadata)).not.toContain(imageUrl)
  })
})

describe('projectLightOcrMessage', () => {
  it('keeps the transcript attachment while replacing it with local OCR text for provider input', () => {
    const message = {
      id: 'message-1',
      role: 'user',
      parts: [
        { type: 'text', text: 'What does this say?' },
        {
          type: 'file',
          mediaType: 'image/png',
          filename: 'receipt.png',
          url: 'file:///tmp/receipt.png',
          providerMetadata: {
            cradle: {
              lightOcr: { version: 1, text: 'Total: $12.00' },
            },
          },
        },
      ],
    } as UIMessage

    const projected = projectLightOcrMessage(message)

    expect(message.parts[1]?.type).toBe('file')
    expect(projected.parts).toEqual([
      { type: 'text', text: 'What does this say?' },
      {
        type: 'text',
        text: [
          'Text recognized locally from receipt.png:',
          '<cradle-local-image-ocr>',
          'Total: $12.00',
          '</cradle-local-image-ocr>',
        ].join('\n'),
      },
    ])
  })

  it('does not rewrite ordinary attachments', () => {
    const message = {
      id: 'message-1',
      role: 'user',
      parts: [
        {
          type: 'file',
          mediaType: 'image/png',
          url: 'file:///tmp/image.png',
        },
      ],
    } as UIMessage

    expect(projectLightOcrMessage(message)).toBe(message)
  })
})

describe('resolveMessageBlobReferences', () => {
  afterEach(() => {
    shutdownInfra()
  })

  it('converts cradle-blob file parts to byte-identical data URLs for provider input', async () => {
    await withTempDataDir(async () => {
      const bytes = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0xFF])
      const blob = putBlob({ bytes, mediaType: 'image/png', d: db() })
      const message = {
        id: 'message-1',
        role: 'user',
        parts: [
          { type: 'text', text: 'Look at this.' },
          {
            type: 'file',
            mediaType: 'image/png',
            filename: 'shot.png',
            url: formatBlobUrl(blob.id),
          },
        ],
      } as UIMessage

      const resolved = await resolveMessageBlobReferences(message)
      const filePart = resolved.parts[1]
      expect(filePart?.type).toBe('file')
      if (filePart?.type !== 'file') {
        throw new Error('expected file part')
      }
      expect(filePart.url).toBe(`data:image/png;base64,${bytes.toString('base64')}`)
      expect(filePart.url).not.toContain('cradle-blob:')
      expect(JSON.stringify(resolved)).not.toContain('cradle-blob:')
      expect(message.parts[1]).toMatchObject({ url: formatBlobUrl(blob.id) })
    })
  })

  it('replaces a missing file blob with an honest marker, never a cradle-blob URL', async () => {
    await withTempDataDir(async () => {
      const missingUrl = formatBlobUrl('missing-blob-id')
      const message = {
        id: 'message-1',
        role: 'user',
        parts: [
          {
            type: 'file',
            mediaType: 'image/png',
            filename: 'gone.png',
            url: missingUrl,
          },
        ],
      } as UIMessage

      const resolved = await resolveMessageBlobReferences(message)

      expect(resolved.parts).toHaveLength(1)
      expect(resolved.parts[0]).toMatchObject({
        type: 'text',
      })
      if (resolved.parts[0]?.type !== 'text') {
        throw new Error('expected text marker')
      }
      expect(resolved.parts[0].text).toContain('Attachment unavailable')
      expect(resolved.parts[0].text).toContain('missing-blob-id')
      expect(resolved.parts[0].text).toContain('gone.png')
      expect(JSON.stringify(resolved)).not.toContain('cradle-blob:')
      expect(JSON.stringify(resolved)).not.toContain(missingUrl)
    })
  })

  it('resolves ChatBlobPayloadRef tool output to the original JSON for provider input', async () => {
    await withTempDataDir(async () => {
      const originalOutput = { result: 'ok', lines: Array.from({ length: 20 }, (_, i) => `line-${i}`) }
      const json = JSON.stringify(originalOutput)
      const blob = putBlob({ bytes: Buffer.from(json, 'utf8'), mediaType: 'application/json', d: db() })
      const ref: ChatBlobPayloadRef = {
        type: 'cradle.blob-payload-ref.v1',
        blobId: blob.id,
        mediaType: 'application/json',
        originalChars: json.length,
        preview: json.slice(0, 32),
      }
      const message = {
        id: 'assistant-1',
        role: 'assistant',
        parts: [
          {
            type: 'dynamic-tool',
            toolCallId: 'call-1',
            toolName: 'shell',
            state: 'output-available',
            input: { command: 'ls' },
            output: ref,
          },
        ],
      } as UIMessage

      const resolved = await resolveMessageBlobReferences(message)
      const toolPart = resolved.parts[0] as {
        output?: unknown
      }

      expect(toolPart.output).toEqual(originalOutput)
      expect(JSON.stringify(resolved)).not.toContain('cradle.blob-payload-ref.v1')
      expect(JSON.stringify(resolved)).not.toContain(blob.id)
      expect((message.parts[0] as { output: unknown }).output).toEqual(ref)
    })
  })

  it('replaces a missing tool payload blob with an honest marker, never a ChatBlobPayloadRef', async () => {
    await withTempDataDir(async () => {
      const ref: ChatBlobPayloadRef = {
        type: 'cradle.blob-payload-ref.v1',
        blobId: 'missing-tool-blob',
        mediaType: 'application/json',
        originalChars: 900_000,
        preview: '{"partial":true',
      }
      const message = {
        id: 'assistant-1',
        role: 'assistant',
        parts: [
          {
            type: 'dynamic-tool',
            toolCallId: 'call-1',
            toolName: 'shell',
            state: 'output-available',
            input: { command: 'cat huge' },
            output: ref,
          },
        ],
      } as UIMessage

      const resolved = await resolveMessageBlobReferences(message)
      const toolPart = resolved.parts[0] as { output?: unknown }

      expect(typeof toolPart.output).toBe('string')
      expect(toolPart.output).toContain('Tool payload unavailable')
      expect(toolPart.output).toContain('missing-tool-blob')
      expect(toolPart.output).toContain('{"partial":true')
      expect(JSON.stringify(resolved)).not.toContain('cradle.blob-payload-ref.v1')
    })
  })

  it('returns the same object reference when nothing needs resolving', async () => {
    await withTempDataDir(async () => {
      const message = {
        id: 'message-1',
        role: 'user',
        parts: [
          { type: 'text', text: 'hello' },
          {
            type: 'file',
            mediaType: 'image/png',
            url: 'data:image/png;base64,aaa',
          },
        ],
      } as UIMessage

      expect(await resolveMessageBlobReferences(message)).toBe(message)
    })
  })

  it('projectProviderInputMessage resolves blobs before Light OCR sees image bytes', async () => {
    await withTempDataDir(async () => {
      const bytes = Buffer.from('ocr-source-bytes')
      const blob = putBlob({ bytes, mediaType: 'image/png', d: db() })
      const message = {
        id: 'message-1',
        role: 'user',
        parts: [
          {
            type: 'file',
            mediaType: 'image/png',
            filename: 'scan.png',
            url: formatBlobUrl(blob.id),
            providerMetadata: {
              cradle: {
                lightOcr: { version: 1, text: 'Recognized line' },
              },
            },
          },
        ],
      } as UIMessage

      const projected = await projectProviderInputMessage(message)

      expect(projected.parts).toEqual([
        {
          type: 'text',
          text: [
            'Text recognized locally from scan.png:',
            '<cradle-local-image-ocr>',
            'Recognized line',
            '</cradle-local-image-ocr>',
          ].join('\n'),
        },
      ])
      expect(JSON.stringify(projected)).not.toContain('cradle-blob:')
    })
  })

  it('resolves text payloadRef to full prose so providers never see an unresolved reference', async () => {
    await withTempDataDir(async () => {
      const fullText = 'full-assistant-prose-that-must-reach-the-model'
      const blob = putBlob({
        bytes: Buffer.from(fullText, 'utf8'),
        mediaType: 'text/plain',
        d: db(),
      })
      const message = {
        id: 'assistant-1',
        role: 'assistant',
        parts: [
          {
            type: 'text',
            text: 'full-assistant',
            providerMetadata: {
              cradle: {
                truncated: true,
                originalChars: fullText.length,
                payloadRef: {
                  type: 'cradle.blob-payload-ref.v1',
                  blobId: blob.id,
                  mediaType: 'text/plain',
                  originalChars: fullText.length,
                  preview: 'full-assistant',
                },
              },
            },
          },
        ],
      } as UIMessage

      const resolved = await resolveMessageBlobReferences(message)
      expect(resolved.parts[0]).toMatchObject({ type: 'text', text: fullText })
      expect(JSON.stringify(resolved)).not.toContain('payloadRef')
      expect(JSON.stringify(resolved)).not.toContain('cradle.blob-payload-ref.v1')
      expect(JSON.stringify(resolved)).not.toContain(blob.id)
      // Original transcript message is untouched.
      expect(
        (message.parts[0] as { providerMetadata?: { cradle?: { payloadRef?: unknown } } })
          .providerMetadata
?.cradle
?.payloadRef,
      ).toMatchObject({ blobId: blob.id })
    })
  })
})
