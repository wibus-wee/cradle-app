// Chat-owned command boundary for session runtime settings.
import {
  getChatSessionsBySessionIdRuntimeSettings,
  patchChatSessionsBySessionIdRuntimeSettings,
} from '~/api-gen/sdk.gen'
import type { ClaudeAgentModelAliases } from '~/features/agent-runtime/claude-agent-config'

import type { ChatRuntimeSettings, ChatRuntimeSettingsPatch } from './chat-response-command'

export interface SessionClaudeAgentConfig {
  modelAliases: ClaudeAgentModelAliases
}

export interface SessionClaudeAgentConfigPatch {
  modelAliases?: Partial<ClaudeAgentModelAliases>
}

export type SessionRuntimeSettingsPatch = ChatRuntimeSettingsPatch & {
  claudeAgent?: SessionClaudeAgentConfigPatch | null
}

export interface ChatRuntimeSettingsResponse {
  sessionId: string
  runtimeSettings: ChatRuntimeSettings
  claudeAgent: SessionClaudeAgentConfig | null
  applied: boolean
}

export const DEFAULT_CHAT_RUNTIME_SETTINGS: ChatRuntimeSettings = {
  accessMode: 'full-access',
  interactionMode: 'default',
}

export const runtimeSettingsQueryKey = (sessionId: string | null) => ['chat', 'runtime-settings', sessionId ?? 'no-session'] as const

export async function getSessionRuntimeSettings(sessionId: string): Promise<ChatRuntimeSettingsResponse> {
  const response = await getChatSessionsBySessionIdRuntimeSettings({
    path: { sessionId },
    throwOnError: true,
  })
  return response.data as ChatRuntimeSettingsResponse
}

export async function updateSessionRuntimeSettings(args: {
  sessionId: string
  patch: SessionRuntimeSettingsPatch
}): Promise<ChatRuntimeSettingsResponse> {
  const response = await patchChatSessionsBySessionIdRuntimeSettings({
    path: { sessionId: args.sessionId },
    body: args.patch,
    throwOnError: true,
  })
  return response.data as ChatRuntimeSettingsResponse
}
