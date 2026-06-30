import { describe, expect, it } from 'vitest'
import type { FileUIPart, UIMessage } from 'ai'

import { buildOptimisticUserMessage } from './optimistic-chat-turn'
import { readUserMessageDraft } from './read-user-message-draft'

import type { ChatContextPart } from '../context/chat-context-parts'

const skillContext: ChatContextPart = {
  type: 'data-cradle-skill',
  name: 'my-skill',
  path: '/skills/my-skill',
  scope: 'workspace',
  description: 'A test skill',
}

const filePart: FileUIPart = {
  type: 'file',
  mediaType: 'image/png',
  url: 'data:image/png;base64,AAA',
}

describe('readUserMessageDraft', () => {
  it('extracts plain text from a user message', () => {
    const message: UIMessage = {
      id: 'm1',
      role: 'user',
      parts: [{ type: 'text', text: 'Hello there' }],
    }
    expect(readUserMessageDraft(message)).toEqual({ text: 'Hello there', contextParts: [], files: [] })
  })

  it('returns null for non-user messages', () => {
    const message: UIMessage = {
      id: 'm2',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Hi' }],
    }
    expect(readUserMessageDraft(message)).toBeNull()
  })

  it('returns null when there is nothing user-authored to recover', () => {
    const message: UIMessage = {
      id: 'm3',
      role: 'user',
      parts: [{ type: 'tool-...' } as unknown as UIMessage['parts'][number]],
    }
    // A part type we ignore yields no recoverable payload.
    expect(readUserMessageDraft(message)).toBeNull()
  })

  it('reconstructs text, context parts, and file attachments', () => {
    // buildOptimisticUserMessage interleaves text + context parts and appends files,
    // exactly the shape persisted for a user turn. Reading it back must round-trip.
    const message = buildOptimisticUserMessage({
      messageId: 'm4',
      text: 'Use the skill please',
      contextParts: [skillContext],
      files: [filePart],
    })
    const draft = readUserMessageDraft(message)
    expect(draft).not.toBeNull()
    expect(draft!.text).toBe('Use the skill please')
    expect(draft!.contextParts).toEqual([skillContext])
    expect(draft!.files).toEqual([filePart])
  })

  it('round-trips through buildOptimisticUserMessage for a text + context draft', () => {
    const message = buildOptimisticUserMessage({
      messageId: 'm5',
      text: 'Plan the migration',
      contextParts: [skillContext],
    })
    const draft = readUserMessageDraft(message)
    const rebuilt = buildOptimisticUserMessage({
      messageId: 'm5b',
      text: draft!.text,
      contextParts: draft!.contextParts,
      files: draft!.files,
    })
    expect(readUserMessageDraft(rebuilt)).toEqual(draft)
  })
})
