import type { ChatActivitySheetProps } from './chat-activity-sheet-contract'
import type { ChatViewProps } from './ChatView'

export const chatActivitySheetFixture: ChatActivitySheetProps = {
  message: {
    id: 'assistant-activity-1',
    parts: [{ type: 'reasoning', text: 'Inspect the Mobile surface before making a focused change.' }],
    role: 'assistant',
  },
  onClose: () => {},
  visible: true,
}

export const chatFixture: ChatViewProps = {
  clearComposerDraftSignal: 0,
  composerDraft: { files: [], text: '' },
  composerDraftKey: 'chat:session-1',
  hasEarlier: false,
  messages: [],
  onCancel: () => {},
  onComposerDraftChange: () => {},
  onCopyMessage: async () => {},
  onLoadEarlier: () => {},
  onModeChange: () => {},
  onRequestMessageDetail: () => {},
  onSend: () => {},
  onShareMessage: async () => {},
}
