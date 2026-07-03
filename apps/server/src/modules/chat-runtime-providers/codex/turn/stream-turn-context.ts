import { unlinkSync } from 'node:fs'

import type {
  ChatRuntimeSettings,
  StreamTurnInput,
} from '../../../chat-runtime/runtime-provider-types'
import {
  ProviderErrors,
  ProviderRuntimeError,
  requireRuntimeProviderTargetProfile,
} from '../../../chat-runtime/runtime-provider-types'
import type { CodexConfig } from '../../../provider-contracts/provider-base'
import { readTrustedCodexConfig } from '../../../provider-contracts/provider-base'
import type { RuntimeKind } from '../../../provider-contracts/types'
import { extractProviderInputText } from '../../kit/input-projector'
import { readWorkspaceProviderStateSnapshot } from '../../provider-state-snapshot'
import type { CodexAppServerAuthCarrier, CodexAppServerAuthResolution } from '../app-server/chatgpt-auth'
import type { CodexAppServerClientOptions } from '../app-server/client'
import { buildCradleCodexAppServerEnv } from '../app-server/client'
import type { ReasoningEffort } from '../app-server-protocol/ReasoningEffort'
import type { ThreadForkParams } from '../app-server-protocol/v2/ThreadForkParams'
import {
  buildCodexAuthEnvironment,
  buildCodexConfig,
  codexConfigRequiresApiKey,
  projectCodexRuntimeAccessMode,
  readCodexReasoningEffort,
  resolveCodexSkillExtraRoots,
  writeSystemPromptFile,
} from '../config/runtime-config'
import { resolveCodexRuntimeContext } from '../config/runtime-context'
import type { CodexUserInput } from './input-projector'
import {
  isCodexCompactCommand,
  projectCodexUserInput,
  readCodexGoalCommandObjective,
} from './input-projector'
import { isCodexGoalContinuationMessage } from '../goal-continuation'
import { isLiveCodexSideFork } from './thread-lifecycle'

export type CodexStreamRuntimeAccess = ReturnType<typeof projectCodexRuntimeAccessMode>

export interface CodexStreamTurnContext {
  config: CodexConfig
  auth: CodexAppServerAuthResolution
  effectiveModel: string | undefined
  userInput: CodexUserInput[]
  userPromptText: string
  goalContinuationRequested: boolean
  goalCommandObjective: string | null
  compactCommandRequested: boolean
  workspacePath: string
  agentId: string | null
  runtimeContext: ReturnType<typeof resolveCodexRuntimeContext>
  systemPromptFile: string | null
  runtimeSettings: ChatRuntimeSettings | undefined
  requestedReasoningEffort: ReasoningEffort
  runtimeAccess: CodexStreamRuntimeAccess | null
  skillExtraRoots: string[]
  codexConfig: NonNullable<ThreadForkParams['config']>
  codexEnv: Record<string, string>
  serverRequestHandler: NonNullable<CodexAppServerClientOptions['serverRequestHandler']>
  shouldInjectReconstructedHistory: boolean
  isFreshProviderThread: boolean
  isLiveSideFork: boolean
}

export interface CodexStreamTurnContextDeps {
  runtimeKind: RuntimeKind
  resolveAppServerAuth: (
    profile: CodexAppServerAuthCarrier,
    config: Pick<CodexConfig, 'apiKey' | 'authMode' | 'bedrock'>,
  ) => CodexAppServerAuthResolution
  resolveSkillPaths: (workspacePath: string) => string[]
  createServerRequestHandler: (
    auth: CodexAppServerAuthResolution,
  ) => NonNullable<CodexAppServerClientOptions['serverRequestHandler']>
}

export function resolveCodexStreamTurnContext(
  input: StreamTurnInput,
  deps: CodexStreamTurnContextDeps,
): CodexStreamTurnContext {
  const profile = requireRuntimeProviderTargetProfile(input.profile, deps.runtimeKind)
  const config = readTrustedCodexConfig(profile.configJson)
  const auth = deps.resolveAppServerAuth(profile, config)
  const effectiveModel = input.modelId ?? config.model
  const userInput = projectCodexUserInput(input.message, 'Codex provider')
  const userPromptText = extractProviderInputText(input.message).trim()
  const goalContinuationRequested = typeof input.message !== 'string' && isCodexGoalContinuationMessage(input.message)
  const goalCommandObjective = readCodexGoalCommandObjective(input.message)
  const compactCommandRequested = isCodexCompactCommand(input.message)
  if (codexConfigRequiresApiKey(config, auth)) {
    throw new ProviderRuntimeError(ProviderErrors.authFailed(deps.runtimeKind))
  }

  let systemPromptFile: string | null = null
  try {
    const snapshot = readWorkspaceProviderStateSnapshot(input.runtimeSession.providerStateSnapshot)
    const workspacePath = snapshot.workspacePath ?? '.'
    const agentId = input.agentId ?? snapshot.agentId ?? null
    const runtimeContext = resolveCodexRuntimeContext(workspacePath, agentId)
    systemPromptFile = writeSystemPromptFile(input.systemPrompt)
    const runtimeSettings = input.providerOptions?.runtimeSettings
    const requestedReasoningEffort = readCodexReasoningEffort(
      input.providerOptions?.thinkingEffort,
      config.reasoningEffort,
    )
    const runtimeAccess = runtimeSettings
      ? projectCodexRuntimeAccessMode(runtimeSettings.accessMode, {
          writableRoots: runtimeContext.runtimeWorkspaceRoots,
          additionalDirectories: config.additionalDirectories,
        })
      : null
    const skillExtraRoots = resolveCodexSkillExtraRoots(config, workspacePath, deps.resolveSkillPaths)
    const codexConfig = buildCodexConfig(
      config,
      workspacePath,
      deps.resolveSkillPaths,
      systemPromptFile,
      effectiveModel,
      auth,
    )
    if (runtimeAccess) {
      codexConfig.approval_policy = runtimeAccess.approvalPolicy
      codexConfig.sandbox_mode = runtimeAccess.sandbox
    }
    const codexEnv = {
      ...buildCradleCodexAppServerEnv({
        chatSessionId: input.runtimeSession.chatSessionId,
        workspaceId: input.workspaceId,
        workspacePath,
        agentId,
        agentHome: runtimeContext.agentHome,
      }),
      ...buildCodexAuthEnvironment(auth),
    }

    return {
      config,
      auth,
      effectiveModel,
      userInput,
      userPromptText,
      goalContinuationRequested,
      goalCommandObjective,
      compactCommandRequested,
      workspacePath,
      agentId,
      runtimeContext,
      systemPromptFile,
      runtimeSettings,
      requestedReasoningEffort,
      runtimeAccess,
      skillExtraRoots,
      codexConfig,
      codexEnv,
      serverRequestHandler: deps.createServerRequestHandler(auth),
      shouldInjectReconstructedHistory: !input.runtimeSession.providerSessionId,
      isFreshProviderThread: !input.runtimeSession.providerSessionId,
      isLiveSideFork: isLiveCodexSideFork(input.runtimeSession),
    }
  }
  catch (error) {
    disposeCodexSystemPromptFile(systemPromptFile)
    throw error
  }
}

export function disposeCodexSystemPromptFile(filePath: string | null): void {
  if (!filePath) {
    return
  }
  try {
    unlinkSync(filePath)
  }
  catch {
    // Best-effort cleanup for per-turn temporary prompt files.
  }
}
