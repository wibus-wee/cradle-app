import { describe, expect, it } from 'vitest'

import type { ComposerDraft } from './composer-draft-store'
import { useComposerDraftStore } from './composer-draft-store'

const DRAFT_WITH_ATTACHMENT: ComposerDraft = {
  text: 'Has attachment',
  contextParts: [],
  files: [
    {
      type: 'file',
      mediaType: 'image/png',
      url: 'data:image/png;base64,AAA',
      filename: 'a.png',
    },
  ],
  pastedTexts: [],
}

describe('composer draft store persistence', () => {
  it('strips file attachments from the persisted localStorage payload', () => {
    useComposerDraftStore.getState().setDraft('surface-1', DRAFT_WITH_ATTACHMENT)

    const partialize = useComposerDraftStore.persist.getOptions().partialize
    expect(partialize).toBeTypeOf('function')
    if (!partialize) {
      throw new TypeError('Expected composer draft persistence to define partialize')
    }

    const persisted = partialize(useComposerDraftStore.getState()) as {
      drafts: Record<string, ComposerDraft>
    }
    expect(persisted.drafts['surface-1']).toEqual({
      text: 'Has attachment',
      contextParts: [],
      files: [],
      pastedTexts: [],
    })
    // The in-memory draft keeps attachments for same-session remount restore.
    expect(useComposerDraftStore.getState().getDraft('surface-1')?.files).toHaveLength(1)
  })
})
