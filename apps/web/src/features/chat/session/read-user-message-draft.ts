import type { FileUIPart, UIMessage } from 'ai'

import type { ComposerPastedText } from '../composer/pasted-text'
import { extractPastedTextsFromPrompt } from '../composer/pasted-text'
import type { ChatContextPart } from '../context/chat-context-parts'
import {
  readFileLineCommentContextPart,
  readPluginContextPart,
  readSkillContextPart,
} from '../context/chat-context-parts'

/**
 * The user-authored payload recovered from a persisted user message, shaped so
 * the Composer can reload it as an editable draft (text + context + files).
 */
export interface UserMessageDraft {
  text: string
  contextParts: ChatContextPart[]
  files: FileUIPart[]
  pastedTexts: ComposerPastedText[]
}

/**
 * Reconstructs an editable Composer draft from a persisted user `UIMessage`.
 *
 * The optimistic user message interleaves `text` parts with `data-cradle-skill`
 * / `data-cradle-plugin` context parts and appends `FileUIPart` attachments.
 * This reverses that: concatenated plain text for the editor, context parts for
 * the context bar, and file parts for the attachment controller.
 *
 * Non-user-authored parts (tool calls, dynamic UI state, etc.) are ignored so
 * reloading a draft never smuggles provider-owned content back into the editor.
 */
export function readUserMessageDraft(
  message: UIMessage | undefined | null,
): UserMessageDraft | null {
  if (!message || message.role !== 'user') {
    return null
  }

  const textSegments: string[] = []
  const contextParts: ChatContextPart[] = []
  const files: FileUIPart[] = []

  for (const part of message.parts) {
    if (part.type === 'text') {
      const text = (part as { text?: unknown }).text
      if (typeof text === 'string') {
        textSegments.push(text)
      }
      continue
    }
    const skillPart = readSkillContextPart(part)
    if (skillPart) {
      contextParts.push(skillPart)
      continue
    }
    const pluginPart = readPluginContextPart(part)
    if (pluginPart) {
      contextParts.push(pluginPart)
      continue
    }
    const fileLineCommentPart = readFileLineCommentContextPart(part)
    if (fileLineCommentPart) {
      contextParts.push(fileLineCommentPart)
      continue
    }
    if (part.type === 'file') {
      files.push(part as FileUIPart)
    }
  }

  // Join multi-segment text with a newline so context-mention gaps don't merge words.
  const extracted = extractPastedTextsFromPrompt(
    textSegments
      .map(segment => segment)
      .join('\n')
      .trim(),
  )
  const text = extracted.text

  if (!text && contextParts.length === 0 && files.length === 0) {
    return null
  }

  return { text, contextParts, files, pastedTexts: extracted.pastedTexts }
}
