import type { UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'

import { projectLightOcrMessage } from './ui-message'

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
