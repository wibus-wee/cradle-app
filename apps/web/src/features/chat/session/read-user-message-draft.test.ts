import type { FileUIPart, UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'

import type { ChatContextPart } from '../context/chat-context-parts'
import { buildOptimisticUserMessage, readGoalCommandObjective } from './optimistic-chat-turn'
import { readUserMessageDraft } from './read-user-message-draft'

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
    expect(readUserMessageDraft(message)).toEqual({
      text: 'Hello there',
      contextParts: [],
      files: [],
      pastedTexts: [],
    })
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

  it('recovers file line comments and collapsed pasted text', () => {
    const message = buildOptimisticUserMessage({
      messageId: 'm-line-comment',
      text: 'Please update this\n\n<pasted_text>\n[{"text":"large pasted body"}]\n</pasted_text>',
      contextParts: [{
        type: 'data-cradle-file-line-comment',
        workspaceId: 'workspace-1',
        path: 'src/app.ts',
        lineStart: 4,
        lineEnd: 4,
        comment: 'Extract this condition.',
      }],
    })

    expect(readUserMessageDraft(message)).toMatchObject({
      text: 'Please update this',
      contextParts: [{ type: 'data-cradle-file-line-comment', path: 'src/app.ts', lineStart: 4 }],
      pastedTexts: [{ text: 'large pasted body' }],
    })
  })
})

describe('buildOptimisticUserMessage', () => {
  it('annotates goal command only when the runtime descriptor supports it', () => {
    const plainMessage = buildOptimisticUserMessage({
      messageId: 'm6',
      text: '/goal Finish the refactor',
    })
    expect(readUserMessageDraft(plainMessage)?.text).toBe('/goal Finish the refactor')
    expect(plainMessage.metadata).toBeUndefined()

    const goalMessage = buildOptimisticUserMessage({
      messageId: 'm7',
      text: '/goal Finish the refactor',
      supportsGoalCommand: true,
    })
    expect(readUserMessageDraft(goalMessage)?.text).toBe('Finish the refactor')
    expect(goalMessage.metadata).toEqual({
      cradle: {
        goal: { objective: 'Finish the refactor' },
      },
    })
  })
})

describe('readGoalCommandObjective', () => {
  it('requires a goal command boundary', () => {
    expect(readGoalCommandObjective('/goal Finish it')).toBe('Finish it')
    expect(readGoalCommandObjective('/goalish Finish it')).toBeNull()
    expect(readGoalCommandObjective('/goal')).toBeNull()
  })
})
