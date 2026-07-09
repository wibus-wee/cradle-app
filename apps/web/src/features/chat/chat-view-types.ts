import type { MutableRefObject, ReactNode } from 'react'

import type { ModelDescriptor, RuntimeKind } from '~/features/agent-runtime/types'

import type { ChatComposerRuntime } from './composer/use-chat-composer-runtime'
import type { MentionItem, PluginMentionItem } from './mentions/mention-panel'
import type { SkillMentionItem } from './mentions/skill-mention-panel'
import type { MessageTextTransform } from './rendering/message-bubble'
import type { SendMessageOptions } from './session/use-chat-session'

export interface ChatViewProps {
  active?: boolean
  sessionId: string | null
  /** Available files for @ mention */
  availableFiles?: MentionItem[]
  /** Lazy workspace file search for @ mention */
  searchFiles?: (query: string, signal?: AbortSignal) => Promise<MentionItem[]>
  /** Lazy plugin search for @ mention */
  searchPlugins?: (query: string, signal?: AbortSignal) => Promise<PluginMentionItem[]>
  /** Lazy skill search for $ mention */
  searchSkills?: (query: string, signal?: AbortSignal) => Promise<SkillMentionItem[]>
  /** Custom toolbar rendered in the composer left slot */
  composerToolbar?: ReactNode
  /** Additional toolbar content rendered after the default composer toolbar */
  composerToolbarAddon?: ReactNode
  /**
   * Hide the runtime settings gear and the default composer toolbar
   * (runtime/provider/model/thinking controls). Used by ambient hosts like
   * Jarvis that surface only a Context toggle — runtime/model are chosen once
   * in preferences, not per message. Only `composerToolbarAddon` remains.
   */
  hideRuntimeToolbar?: boolean
  /** Ref to read per-message overrides (modelId, thinkingEffort) before sending */
  sendOverridesRef?: MutableRefObject<{
    providerTargetId?: string
    modelId?: string | null
    thinkingEffort?: SendMessageOptions['thinkingEffort']
  }>
  /** Currently selected composer model, including provider-switched chat sessions before the first run persists. */
  composerModel?: ModelDescriptor | null
  /** Custom context bar rendered before the send button */
  composerContextBar?: ReactNode
  /**
   * Strip the transcript + composer horizontal inset for ambient hosts that
   * render ChatView inside a narrow floating panel (e.g. Jarvis). Drops the
   * `max-w-[90%]` reading-width constraint and the `pr-12` minimap gutter
   * (the minimap is already hidden via `hideRuntimeToolbar` in these hosts)
   * and reduces side padding to `px-1` so the scarce horizontal space isn't
   * wasted. The main chat view is unaffected (defaults to false).
   */
  compactInset?: boolean
  /** Placeholder text for composer */
  placeholder?: string
  runtimeKind?: RuntimeKind
  workspaceId?: string | null
  /** When set, composer catalogs and connection gating use the remote host. */
  remoteHostId?: string | null
  messageTextTransform?: MessageTextTransform
  prepareSend?: (input: {
    text: Parameters<ChatComposerRuntime['send']>[0]
    files: Parameters<ChatComposerRuntime['send']>[1]
    contextParts: Parameters<ChatComposerRuntime['send']>[2]
    options?: Parameters<ChatComposerRuntime['send']>[3]
  }) => {
    text: Parameters<ChatComposerRuntime['send']>[0]
    files?: Parameters<ChatComposerRuntime['send']>[1]
    contextParts?: Parameters<ChatComposerRuntime['send']>[2]
    options?: Parameters<ChatComposerRuntime['send']>[3]
  }
}
