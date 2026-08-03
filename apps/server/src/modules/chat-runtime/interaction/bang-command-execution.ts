import { AppError } from '../../../errors/app-error'
import type { BangCommandExecutionResult } from '../bang-command'
import { executeLocalBangCommand, persistBangCommandMessages } from '../bang-command'
import { getRuntimeRegistry } from '../chat-runtime-provider-registry'
import { runRegistry } from '../run-registry'
import {
  assertRunnableSession,
  assertRuntimeCompatibleTarget,
  assertStoredSession,
  attachBinding,
  resolveRuntimeSessionForContext,
} from '../runtime-session-context'

export interface ExecuteBangCommandInput {
  sessionId: string
  command: string
  signal?: AbortSignal
}

export interface PersistBangTranscriptInput {
  sessionId: string
  transcript: string
  command?: string
  durationMs?: number
  exitCode?: number | null
}

const BANG_TRANSCRIPT_MAX_CHARS = 100 * 1024

/** Persist an interactive Composer bang PTY transcript without executing a shell command. */
export async function persistBangTranscript(
  input: PersistBangTranscriptInput,
): Promise<BangCommandExecutionResult> {
  assertStoredSession(input.sessionId)
  const transcript = input.transcript.replace(/\0/g, '')
  const truncated = transcript.length > BANG_TRANSCRIPT_MAX_CHARS
  const stdout = truncated ? transcript.slice(0, BANG_TRANSCRIPT_MAX_CHARS) : transcript
  const command = (input.command?.trim() || 'interactive shell')
  const durationMs = typeof input.durationMs === 'number' && input.durationMs >= 0
    ? Math.round(input.durationMs)
    : 0
  const exitCode = input.exitCode === undefined ? 0 : input.exitCode

  const persisted = await persistBangCommandMessages({
    sessionId: input.sessionId,
    command,
    stdout,
    stderr: '',
    exitCode,
    durationMs,
    timedOut: false,
    truncated,
  })

  return {
    command,
    stdout,
    stderr: '',
    exitCode,
    durationMs,
    timedOut: false,
    truncated,
    ...persisted,
  }
}

export async function executeBangCommand(
  input: ExecuteBangCommandInput,
): Promise<BangCommandExecutionResult> {
  const command = normalizeBangCommandOrThrow(input.command)
  const session = assertStoredSession(input.sessionId)
  const runtimeKind = session.runtimeKind ?? 'standard'
  const runtime = getRuntimeRegistry().get(runtimeKind)

  if (!runtime?.capabilities.supportsShellExecution || !runtime.executeShellCommand) {
    return await executeLocalBangCommand({ ...input, command })
  }

  const context = assertRuntimeCompatibleTarget(assertRunnableSession(input.sessionId))
  if (context.profile && !context.profile.enabled) {
    throw new AppError({
      code: 'chat_provider_target_not_available',
      status: 409,
      message: 'Provider target is disabled',
      details: {
        providerTargetId: context.providerTarget?.id ?? null,
      },
    })
  }

  const activeRunId = runRegistry.getActiveRunIdForSession(input.sessionId)
  if (
    activeRunId
    && runRegistry.getActiveRun(activeRunId)?.runtimeSession.runtimeKind === runtimeKind
  ) {
    throw new AppError({
      code: 'chat_bang_command_runtime_busy',
      status: 409,
      message: 'Runtime bang commands cannot run while a response is streaming',
      details: { sessionId: input.sessionId },
    })
  }

  const { runtimeSession, requestedModelId } = await resolveRuntimeSessionForContext({
    sessionId: input.sessionId,
    context,
    runtimeKind,
    runtime,
  })

  const output = await runtime.executeShellCommand({
    runtimeSession,
    profile: context.profile,
    workspaceId: context.session.workspaceId,
    workspacePath: context.workspacePath,
    agentId: context.session.agentId,
    modelId: requestedModelId ?? undefined,
    command,
    signal: input.signal,
  })

  attachBinding({
    sessionId: input.sessionId,
    providerTargetId: context.providerTarget?.id ?? null,
    runtimeKind: runtimeSession.runtimeKind,
    runtimeSession,
    requestedModelId,
  })

  return {
    ...output,
    ...(await persistBangCommandMessages({
      sessionId: input.sessionId,
      ...output,
    })),
  }
}

function normalizeBangCommandOrThrow(commandText: string): string {
  const command = commandText.trim()
  if (!command) {
    throw new AppError({
      code: 'chat_bang_command_empty',
      status: 400,
      message: 'Bang command must not be empty',
    })
  }
  if (command.includes('\n') || command.includes('\r')) {
    throw new AppError({
      code: 'chat_bang_command_multiline_unsupported',
      status: 400,
      message: 'Bang command must be a single line',
    })
  }
  return command
}
