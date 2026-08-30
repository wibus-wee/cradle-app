import { runRegistry } from '../run-registry'
import type {
  RuntimeTurnSettingsPatch,
  UpdateRuntimeTurnSettingsResult,
} from '../runtime-provider-types'
import { getSessionRunContext } from '../runtime-session-context'

export async function updateChatRuntimeTurnSettings(input: {
  sessionId: string
  settings: RuntimeTurnSettingsPatch
}): Promise<UpdateRuntimeTurnSettingsResult> {
  const runId = runRegistry.getActiveRunIdForSession(input.sessionId)
  const activeRun = runId ? runRegistry.getActiveRun(runId) : null
  if (
    !activeRun
    || activeRun.terminalStatus
    || !activeRun.runtime.updateRuntimeTurnSettings
  ) {
    return { status: 'targetUnavailable' }
  }

  const context = getSessionRunContext(input.sessionId)
  if (!context) {
    return { status: 'targetUnavailable' }
  }

  return await activeRun.runtime.updateRuntimeTurnSettings({
    runtimeSession: activeRun.runtimeSession,
    profile: context.profile,
    settings: input.settings,
  })
}
