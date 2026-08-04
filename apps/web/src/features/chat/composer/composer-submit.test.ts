import type { FileUIPart } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import type { ComposerAction } from './composer-state'
import { submitAndClearDraft } from './composer-submit'
import type { PromptEditorController } from './prompt-editor'

function createPromptEditor(initialText: string): PromptEditorController {
  let text = initialText
  return {
    appendText: vi.fn(),
    canNavigateHistory: vi.fn(() => false),
    clear: vi.fn(() => {
      text = ''
    }),
    focus: vi.fn(),
    getContextParts: vi.fn(() => []),
    getText: vi.fn(() => text),
    insertFileMention: vi.fn(),
    insertIntentMention: vi.fn(),
    insertPluginMention: vi.fn(),
    insertSkillMention: vi.fn(),
    insertText: vi.fn(),
    replaceFileTriggerWithText: vi.fn(),
    replaceRangeWithText: vi.fn(),
    setPlaceholder: vi.fn(),
    setDraft: vi.fn(),
    setText: vi.fn((nextText: string) => {
      text = nextText
    }),
  }
}

function submitDraft({
  onResult,
  promptEditor,
  submit,
}: {
  onResult: (outcome: { accepted: boolean, restored: boolean }) => void
  promptEditor: PromptEditorController
  submit: () => Promise<boolean>
}) {
  submitAndClearDraft({
    appendFileParts: vi.fn<(fileParts: FileUIPart[]) => void>(),
    clearAttachments: vi.fn(),
    contextParts: [],
    dispatch: vi.fn<(action: ComposerAction) => void>(),
    files: [],
    onResult,
    promptEditor,
    submit,
    text: 'Keep this objective',
  })
}

describe('submitAndClearDraft', () => {
  it('restores the draft when an async submit is rejected', async () => {
    const promptEditor = createPromptEditor('Keep this objective')
    const onResult = vi.fn()

    submitDraft({
      onResult,
      promptEditor,
      submit: async () => false,
    })

    expect(promptEditor.getText()).toBe('')
    await vi.waitFor(() => expect(promptEditor.getText()).toBe('Keep this objective'))
    expect(onResult).toHaveBeenCalledWith({ accepted: false, restored: true })
  })

  it('reports accepted async submits without restoring the draft', async () => {
    const promptEditor = createPromptEditor('Keep this objective')
    const onResult = vi.fn()

    submitDraft({
      onResult,
      promptEditor,
      submit: async () => true,
    })

    await vi.waitFor(() => expect(onResult).toHaveBeenCalledWith({ accepted: true, restored: false }))
    expect(promptEditor.getText()).toBe('')
  })
})
