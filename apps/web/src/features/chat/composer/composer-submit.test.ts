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
}): boolean {
  return submitAndClearDraft({
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

    const submissionStarted = submitDraft({
      onResult,
      promptEditor,
      submit: async () => false,
    })

    expect(submissionStarted).toBe(true)
    expect(promptEditor.getText()).toBe('')
    await vi.waitFor(() => expect(promptEditor.getText()).toBe('Keep this objective'))
    expect(onResult).toHaveBeenCalledWith({ accepted: false, restored: true })
  })

  it('reports accepted async submits without restoring the draft', async () => {
    const promptEditor = createPromptEditor('Keep this objective')
    const onResult = vi.fn()

    const submissionStarted = submitDraft({
      onResult,
      promptEditor,
      submit: async () => true,
    })

    expect(submissionStarted).toBe(true)
    await vi.waitFor(() => expect(onResult).toHaveBeenCalledWith({ accepted: true, restored: false }))
    expect(promptEditor.getText()).toBe('')
  })

  it('clears the editor once when the submit resolves false asynchronously', async () => {
    const promptEditor = createPromptEditor('Keep this objective')
    const onResult = vi.fn()

    const submissionStarted = submitDraft({
      onResult,
      promptEditor,
      submit: () => Promise.resolve(false),
    })

    expect(submissionStarted).toBe(true)
    expect(promptEditor.getText()).toBe('')
    await vi.waitFor(() => expect(promptEditor.getText()).toBe('Keep this objective'))
    expect(onResult).toHaveBeenCalledWith({ accepted: false, restored: true })
  })

  it('reports synchronous accept without restoring the draft', () => {
    const promptEditor = createPromptEditor('Keep this objective')
    const onResult = vi.fn()

    const submissionStarted = submitAndClearDraft({
      appendFileParts: vi.fn<(fileParts: FileUIPart[]) => void>(),
      clearAttachments: vi.fn(),
      contextParts: [],
      dispatch: vi.fn<(action: ComposerAction) => void>(),
      files: [],
      onResult,
      promptEditor,
      submit: () => true,
      text: 'Keep this objective',
    })

    expect(submissionStarted).toBe(true)
    expect(promptEditor.getText()).toBe('')
    expect(onResult).toHaveBeenCalledWith({ accepted: true, restored: false })
  })

  it('does not overwrite a newer edit when an async submit is rejected', async () => {
    const promptEditor = createPromptEditor('Keep this objective')
    const onResult = vi.fn()
    let resolveSubmit: (result: boolean) => void = () => {}

    const submissionStarted = submitDraft({
      onResult,
      promptEditor,
      submit: () => new Promise<boolean>((resolve) => {
        resolveSubmit = resolve
      }),
    })

    expect(submissionStarted).toBe(true)
    expect(promptEditor.getText()).toBe('')

    // The user starts a newer draft while the rejection is still in flight.
    promptEditor.setText('Newer draft')
    resolveSubmit(false)

    await vi.waitFor(() => expect(onResult).toHaveBeenCalledWith({ accepted: false, restored: true }))
    expect(promptEditor.getText()).toBe('Newer draft')
  })

  it('restores attachments with the snapshot when an async submit is rejected', async () => {
    const promptEditor = createPromptEditor('Keep this objective')
    const onResult = vi.fn()
    const appendFileParts = vi.fn<(fileParts: FileUIPart[]) => void>()
    const files: FileUIPart[] = [
      { type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,AAA', filename: 'a.png' },
    ]

    const submissionStarted = submitAndClearDraft({
      appendFileParts,
      clearAttachments: vi.fn(),
      contextParts: [],
      dispatch: vi.fn<(action: ComposerAction) => void>(),
      files,
      onResult,
      promptEditor,
      submit: () => Promise.resolve(false),
      text: 'Keep this objective',
    })

    expect(submissionStarted).toBe(true)
    await vi.waitFor(() => expect(promptEditor.getText()).toBe('Keep this objective'))
    expect(appendFileParts).toHaveBeenCalledWith(files)
  })

  it('does not start a submission when the sender rejects it synchronously', () => {
    const promptEditor = createPromptEditor('Keep this objective')
    const onResult = vi.fn()

    const submissionStarted = submitAndClearDraft({
      appendFileParts: vi.fn<(fileParts: FileUIPart[]) => void>(),
      clearAttachments: vi.fn(),
      contextParts: [],
      dispatch: vi.fn<(action: ComposerAction) => void>(),
      files: [],
      onResult,
      promptEditor,
      submit: () => false,
      text: 'Keep this objective',
    })

    expect(submissionStarted).toBe(false)
    expect(promptEditor.getText()).toBe('Keep this objective')
    expect(onResult).toHaveBeenCalledWith({ accepted: false, restored: false })
  })
})
