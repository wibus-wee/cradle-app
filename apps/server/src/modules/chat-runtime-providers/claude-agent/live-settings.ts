import type { Options } from '@anthropic-ai/claude-agent-sdk'

import type {
  GetCapabilitiesInput,
  RuntimeSession,
  StreamTurnInput,
  UpdateRuntimeSettingsInput,
} from '../../chat-runtime/runtime-provider-types'
import { updateClaudeAgentPermissionBridgeState } from './permission-bridge'
import type { ActiveClaudeQuery } from './provider-internals'
import { readClaudeAgentPermissionMode } from './runtime-settings'
import type { ClaudeAgentProviderDeps } from './types'

export interface ClaudeAgentLiveSettingsContext {
  activeQueries: Map<string, ActiveClaudeQuery>
  activePermissionModesBySession: Map<string, Options['permissionMode']>
  deps: ClaudeAgentProviderDeps
}

export class ClaudeAgentLiveSettings {
  constructor(private readonly context: ClaudeAgentLiveSettingsContext) {}

  async updateActiveQueryPermissionMode(
    input: Pick<UpdateRuntimeSettingsInput, 'runtimeSession'> & {
      mode: Options['permissionMode']
      runtimeInput?: StreamTurnInput | GetCapabilitiesInput
      runtimeSettings?: UpdateRuntimeSettingsInput['settings']
    },
  ): Promise<void> {
    const sessionId = input.runtimeSession.chatSessionId
    const entry = this.context.activeQueries.get(sessionId)
    if (!entry) {
      return
    }
    const mode = input.mode
    if (!mode) {
      return
    }
    if (this.context.activePermissionModesBySession.get(sessionId) !== mode) {
      await entry.query.setPermissionMode(mode)
    }
    this.context.activePermissionModesBySession.set(sessionId, mode)
    updateClaudeAgentPermissionBridgeState(entry.permissionBridgeState, {
      runtimeInput: input.runtimeInput ?? entry.permissionBridgeState.runtimeInput,
      permissionMode: mode,
      runtimeSettings: input.runtimeSettings ?? entry.permissionBridgeState.runtimeSettings,
    })
  }

  async updateActiveQueryUltracode(input: {
    runtimeSession: RuntimeSession
    enabled: boolean
  }): Promise<void> {
    const entry = this.context.activeQueries.get(input.runtimeSession.chatSessionId)
    if (!entry || entry.ultracodeEnabled === input.enabled) {
      return
    }
    await entry.query.applyFlagSettings({
      effortLevel: input.enabled ? 'xhigh' : null,
      ultracode: input.enabled,
    })
    entry.ultracodeEnabled = input.enabled
  }

  async requestRuntimePermissionModeUpdate(
    runtimeSession: RuntimeSession,
    permissionMode: 'plan',
  ): Promise<void> {
    if (!this.context.deps.updateSessionRuntimeSettings) {
      return
    }

    try {
      await this.context.deps.updateSessionRuntimeSettings({
        sessionId: runtimeSession.chatSessionId,
        patch: { permissionMode },
      })
    }
    catch (error) {
      this.context.deps.logger?.warn?.('Claude Agent runtime permission mode update failed', {
        error,
        sessionId: runtimeSession.chatSessionId,
        permissionMode,
      })
    }
  }

  async updateRuntimeSettings(input: UpdateRuntimeSettingsInput): Promise<void> {
    const mode = readClaudeAgentPermissionMode(input.settings)
    await this.updateActiveQueryPermissionMode({
      runtimeSession: input.runtimeSession,
      mode,
      runtimeSettings: input.settings,
    })
  }
}
