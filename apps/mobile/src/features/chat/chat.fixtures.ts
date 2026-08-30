import type { ChatViewProps } from './ChatView'

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
}
