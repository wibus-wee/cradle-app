import type { RuntimeSettings } from '../../chat-runtime/runtime-provider-types'
import { readCodexLikeRuntimeSettings } from '../../chat-runtime/runtime-settings'

export interface KimiRuntimeSettings {
  permissionMode: 'manual' | 'auto' | 'yolo'
  planMode: boolean
}

export function projectKimiRuntimeSettings(
  settings: RuntimeSettings | null | undefined,
): KimiRuntimeSettings {
  const runtimeSettings = readCodexLikeRuntimeSettings(settings)
  const permissionMode = runtimeSettings.accessMode === 'approval-required'
    ? 'manual'
    : runtimeSettings.accessMode === 'approve-for-me'
      ? 'auto'
      : 'yolo'

  return {
    permissionMode,
    planMode: runtimeSettings.interactionMode === 'plan',
  }
}
