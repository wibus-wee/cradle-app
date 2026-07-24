import type { FileUIPart } from 'ai'

export type ComposerStoryState = 'empty' | 'draft' | 'attachments' | 'streaming' | 'sending' | 'disabled'

export const composerAttachmentFixtures: FileUIPart[] = [
  {
    type: 'file',
    filename: 'architecture-notes.md',
    mediaType: 'text/markdown',
    url: 'data:text/markdown;base64,IyBDb21wb25lbnQgQXJjaGl0ZWN0dXJl',
  },
  {
    type: 'file',
    filename: 'surface.png',
    mediaType: 'image/png',
    url: 'data:image/png;base64,iVBORw0KGgo=',
  },
]

export const composerDraftFixture
  = 'Refactor the visible surface into a props-only View and add stable fixtures.'
