import { sessions } from '@cradle/db'
import { eq } from 'drizzle-orm'

import { currentUnixSeconds } from '../../helpers/time'
import { db } from '../../infra'
import { createChildLogger } from '../../logging/logger'
import { normalizeClaudeAgentConfigPatch } from '../provider-contracts/claude-agent-config'
import type { RuntimeKind } from '../provider-contracts/types'
import { runRegistry } from './run-registry'
import { liveRuntimeSessionRegistry } from './runtime-live-session-registry'
import type {
  RuntimeSettings,
  RuntimeSettingsPatch,
  RuntimeSettingsValue,
} from './runtime-provider-types'
import { assertStoredSession, getSessionRunContext } from './runtime-session-context'
import type { SessionClaudeAgentConfig, SessionClaudeAgentConfigPatchInput } from './runtime-settings'
import {
  areRuntimeSettingsEqual,
  mergeRuntimeSettings,
  normalizeRuntimeSettingsPatch,
  readSessionClaudeAgentConfig,
  readSessionRuntimeSettings,
  writeSessionRuntimeConfigJson,
} from './runtime-settings'

const settingsLogger = createChildLogger({ module: 'chat-runtime.runtime-settings' })

export interface ChatRuntimeSettingsDto {
  sessionId: string
  runtimeKind: RuntimeKind
  runtimeSettings: RuntimeSettings
  claudeAgent: SessionClaudeAgentConfig | null
  applied: boolean
}

export type ChatRuntimeSettingsUpdatePatch = Record<string, RuntimeSettingsValue | SessionClaudeAgentConfigPatchInput | null | undefined> & {
  claudeAgent?: SessionClaudeAgentConfigPatchInput | null
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(value, key)
}

function readSessionRuntimeKind(session: { runtimeKind: RuntimeKind | null }): RuntimeKind {
  return session.runtimeKind ?? 'standard'
}

export function getSessionRuntimeSettings(sessionId: string): ChatRuntimeSettingsDto {
  const session = assertStoredSession(sessionId)
  const runtimeKind = readSessionRuntimeKind(session)
  const runtimeSettings = readSessionRuntimeSettings(runtimeKind, session.configJson)
  return {
    sessionId,
    runtimeKind,
    runtimeSettings,
    claudeAgent: readSessionClaudeAgentConfig(session.configJson),
    applied: readRuntimeSettingsApplied(sessionId, runtimeKind, runtimeSettings),
  }
}

function readRuntimeSettingsPatch(
  patch: ChatRuntimeSettingsUpdatePatch,
): RuntimeSettingsPatch {
  const next: RuntimeSettingsPatch = {}
  for (const [key, value] of Object.entries(patch)) {
    if (
      key !== 'claudeAgent'
      && (
        typeof value === 'string'
        || typeof value === 'number'
        || typeof value === 'boolean'
      )
    ) {
      next[key] = value
    }
  }
  return next
}

export async function updateSessionRuntimeSettings(input: {
  sessionId: string
  patch: ChatRuntimeSettingsUpdatePatch
}): Promise<ChatRuntimeSettingsDto> {
  const patch = readRuntimeSettingsPatch(input.patch)
  const session = assertStoredSession(input.sessionId)
  const runtimeKind = readSessionRuntimeKind(session)
  const rawPatch = input.patch as Record<string, unknown>
  const updateClaudeAgent = hasOwn(rawPatch, 'claudeAgent')
  const claudeAgent = updateClaudeAgent
    ? normalizeClaudeAgentConfigPatch(rawPatch.claudeAgent)
    : undefined
  const runtimeSettings = mergeRuntimeSettings(
    runtimeKind,
    readSessionRuntimeSettings(runtimeKind, session.configJson),
    normalizeRuntimeSettingsPatch(runtimeKind, patch),
  )
  db()
    .update(sessions)
    .set({
      configJson: writeSessionRuntimeConfigJson({
        configJson: session.configJson,
        runtimeKind,
        runtimeSettings,
        claudeAgent,
        updateClaudeAgent,
      }),
      updatedAt: currentUnixSeconds(),
    })
    .where(eq(sessions.id, input.sessionId))
    .run()

  const runId = runRegistry.getActiveRunIdForSession(input.sessionId)
  if (!runId) {
    const applied = await applyIdleSessionRuntimeSettings({
      sessionId: input.sessionId,
      runtimeSettings,
    })
    return {
      sessionId: input.sessionId,
      runtimeKind,
      runtimeSettings,
      claudeAgent: readSessionClaudeAgentConfig(assertStoredSession(input.sessionId).configJson),
      applied,
    }
  }
  const activeRun = runRegistry.getActiveRun(runId)
  let applied = readRuntimeSettingsApplied(input.sessionId, runtimeKind, runtimeSettings)
  if (
    !applied
    && activeRun?.runtime.capabilities.supportsRuntimeSettings
    && activeRun.runtime.updateRuntimeSettings
    && !activeRun.terminalStatus
  ) {
    const context = getSessionRunContext(input.sessionId)
    if (context) {
      try {
        await activeRun.runtime.updateRuntimeSettings({
          runtimeSession: activeRun.runtimeSession,
          profile: context.profile,
          settings: runtimeSettings,
        })
        activeRun.runtimeSettings = runtimeSettings
        applied = true
      }
 catch (error) {
        settingsLogger.warn('update runtime settings failed', {
          error,
          sessionId: input.sessionId,
          runId,
          runtimeSettings,
        })
      }
    }
  }

  return {
    sessionId: input.sessionId,
    runtimeKind,
    runtimeSettings,
    claudeAgent: readSessionClaudeAgentConfig(assertStoredSession(input.sessionId).configJson),
    applied,
  }
}

async function applyIdleSessionRuntimeSettings(input: {
  sessionId: string
  runtimeSettings: RuntimeSettings
}): Promise<boolean> {
  if (runRegistry.hasPendingRun(input.sessionId)) {
    return false
  }

  const liveRuntimeSession = liveRuntimeSessionRegistry.read(input.sessionId)
  if (!liveRuntimeSession) {
    return true
  }

  try {
    await liveRuntimeSession.updateRuntimeSettings(input.runtimeSettings)
    return true
  }
 catch (error) {
    settingsLogger.warn('update idle runtime settings failed', {
      error,
      sessionId: input.sessionId,
      runtimeSettings: input.runtimeSettings,
    })
    return false
  }
}

function readRuntimeSettingsApplied(
  sessionId: string,
  runtimeKind: RuntimeKind,
  runtimeSettings: RuntimeSettings,
): boolean {
  if (runRegistry.hasPendingRun(sessionId)) {
    return false
  }
  const activeRunId = runRegistry.getActiveRunIdForSession(sessionId)
  const activeRun = activeRunId ? runRegistry.getActiveRun(activeRunId) : null
  return !activeRun || areRuntimeSettingsEqual(runtimeKind, activeRun.runtimeSettings, runtimeSettings)
}
