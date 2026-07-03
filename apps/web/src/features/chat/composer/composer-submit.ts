import type { FileUIPart } from 'ai'

import { toastManager } from '~/components/ui/toast'

import type { ChatContextPart } from '../context/chat-context-parts'
import type { SendMessageResult } from '../session/use-chat-session'
import type { ComposerAction } from './composer-state'
import { INITIAL_COMPOSER_STATE } from './composer-state'
import type { PromptEditorController } from './prompt-editor'

export type ComposerSendResult = SendMessageResult | boolean

export type ComposerSendHandler = (
  text: string,
  files: FileUIPart[],
  contextParts: ChatContextPart[],
  options?: { invertContinuationMode?: boolean },
) => ComposerSendResult | Promise<ComposerSendResult>

export function isComposerSendPromise(
  result: ComposerSendResult | Promise<ComposerSendResult>,
): result is Promise<ComposerSendResult> {
  return typeof result === 'object'
    && result !== null
    && 'then' in result
    && typeof result.then === 'function'
}

export function reportComposerSubmitError(error: unknown) {
  console.error('[Composer] submit failed:', error)
  toastManager.add({
    type: 'error',
    title: 'Message submit failed',
    description: error instanceof Error ? error.message : 'Unknown submit error.',
  })
}

function clearSubmittedDraft({
  clearAttachments,
  dispatch,
  promptEditor,
}: {
  clearAttachments: () => void
  dispatch: (action: ComposerAction) => void
  promptEditor: PromptEditorController | null
}) {
  clearAttachments()
  promptEditor?.clear()
  dispatch({ type: 'input/cleared' })
}

function restoreSubmittedDraft({
  appendFileParts,
  contextParts,
  dispatch,
  files,
  promptEditor,
  text,
}: {
  appendFileParts: (fileParts: FileUIPart[]) => void
  contextParts: ChatContextPart[]
  dispatch: (action: ComposerAction) => void
  files: FileUIPart[]
  promptEditor: PromptEditorController | null
  text: string
}) {
  if (promptEditor?.getText().trim()) {
    return
  }

  if (files.length > 0) {
    appendFileParts(files)
  }
  promptEditor?.setText(text)
  dispatch({
    type: 'input/changed',
    state: {
      ...INITIAL_COMPOSER_STATE,
      inputValue: text,
      contextParts,
    },
  })
}

export function submitAndClearDraft({
  appendFileParts,
  clearAttachments,
  contextParts,
  dispatch,
  files,
  options,
  promptEditor,
  submit,
  text,
}: {
  appendFileParts: (fileParts: FileUIPart[]) => void
  clearAttachments: () => void
  contextParts: ChatContextPart[]
  dispatch: (action: ComposerAction) => void
  files: FileUIPart[]
  options?: { invertContinuationMode?: boolean }
  promptEditor: PromptEditorController | null
  submit: ComposerSendHandler
  text: string
}) {
  let result: ComposerSendResult | Promise<ComposerSendResult>
  try {
    result = options
      ? submit(text, files, contextParts, options)
      : submit(text, files, contextParts)
  }
  catch (error) {
    reportComposerSubmitError(error)
    return
  }

  if (result === false) {
    return
  }

  clearSubmittedDraft({ clearAttachments, dispatch, promptEditor })

  if (isComposerSendPromise(result)) {
    void result
      .then((resolved) => {
        if (resolved === false) {
          restoreSubmittedDraft({ appendFileParts, contextParts, dispatch, files, promptEditor, text })
        }
      })
      .catch((error) => {
        reportComposerSubmitError(error)
        restoreSubmittedDraft({ appendFileParts, contextParts, dispatch, files, promptEditor, text })
      })
  }
}

export function readBangCommandDraft(text: string): string | null {
  const normalized = text.trimStart()
  if (!normalized.startsWith('!') || normalized.includes('\n') || normalized.includes('\r')) {
    return null
  }
  const preview = normalized.slice(1).trim()
  return preview || '!'
}
