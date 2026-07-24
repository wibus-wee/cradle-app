import type { FileUIPart } from 'ai'
import type { ReactNode } from 'react'

import type { ClaudeAgentModelAliases } from '~/features/agent-runtime/claude-agent-config'
import type { RuntimeKind } from '~/features/agent-runtime/types'
import type { RuntimeCatalogComposer } from '~/features/agent-runtime/use-runtime-catalog'
import type { RuntimeProviderBinding } from '~/features/composer-toolbar/types'

import type { ChatThinkingEffort, RuntimeSettingsPatchValue } from '../../commands/chat-response-command'
import type { ChatContextPart } from '../../context/chat-context-parts'

export interface DraftClaudeAgentConfig {
  modelAliases: ClaudeAgentModelAliases
}

export type DraftChatRuntimeSettings = Record<string, RuntimeSettingsPatchValue | DraftClaudeAgentConfig | undefined> & {
  claudeAgent?: DraftClaudeAgentConfig | null
}

export interface DraftChatComposerSubmitOptions {
  runtimeKind: RuntimeKind
  providerBinding: RuntimeProviderBinding
  runtimeComposer: RuntimeCatalogComposer
  agentId?: string
  agentName?: string
  acpAgentId?: string
  acpAgentName?: string
  acpDraftSessionId?: string
  providerTargetId?: string
  providerTargetName?: string
  modelId?: string | null
  thinkingEffort?: ChatThinkingEffort
  runtimeSettings: DraftChatRuntimeSettings
}

export type DraftChatComposerSendHandler = (
  text: string,
  files: FileUIPart[],
  contextParts: ChatContextPart[],
  options: DraftChatComposerSubmitOptions,
) => boolean | void | Promise<boolean | void>

export interface DraftChatComposerProps {
  workspaceId: string | null
  remoteHostId?: string | null
  active?: boolean
  contextBar?: ReactNode
  replaceText?: string
  replaceTextKey?: number
  onDraftChange?: (draft: string) => void
  onSend: DraftChatComposerSendHandler
  onSendInNewWindow?: DraftChatComposerSendHandler
  onSendIsolated?: DraftChatComposerSendHandler
  testIdPrefix?: string
  sendButtonText?: string
}

export interface DraftChatReadinessNotice {
  key: string
  icon: React.ComponentType<{ 'className'?: string, 'aria-hidden'?: boolean }>
  message: string
  actionLabel: string
  disabled: boolean
}
