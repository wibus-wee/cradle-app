import { AppError } from '../../../errors/app-error'
import { readPositiveIntegerEnv } from '../../../helpers/env'
import { getRuntimeRegistry } from '../chat-runtime-provider-registry'
import {
  assertRunnableSession,
  assertRuntimeCompatibleTarget,
  resolveRuntimeSessionForContext,
} from '../runtime-session-context'
import { openDirectChunkStream } from '../stream/sse'
import { resolveCradleTurnTranscript } from '../transcript'

const DEFAULT_QUICK_QUESTION_MAX_MESSAGES = 12
const DEFAULT_QUICK_QUESTION_MAX_CHARS = 120_000

export interface QuickQuestionInput {
  sessionId: string
  question: string
}

export async function streamQuickQuestion(
  input: QuickQuestionInput,
): Promise<ReadableStream<Uint8Array>> {
  const context = assertRuntimeCompatibleTarget(assertRunnableSession(input.sessionId))
  const runtimeKind = context.session.runtimeKind ?? 'standard'
  const runtime = getRuntimeRegistry().get(runtimeKind)

  if (!runtime) {
    throw new AppError({
      code: 'chat_runtime_not_available',
      status: 501,
      message: `Runtime is not available: ${runtimeKind}`,
    })
  }

  if (!runtime.quickQuestion) {
    throw new AppError({
      code: 'quick_question_not_supported',
      status: 409,
      message: 'This provider does not support quick questions',
      details: { runtimeKind },
    })
  }

  const question = input.question.trim()
  if (!question) {
    throw new AppError({
      code: 'chat_message_empty',
      status: 400,
      message: 'Quick question requires non-empty text',
    })
  }

  const resolved = await resolveRuntimeSessionForContext({
    sessionId: input.sessionId,
    context,
    runtimeKind,
    runtime,
  })

  const transcript = await resolveCradleTurnTranscript({
    sessionId: input.sessionId,
    excludedMessageIds: new Set(),
    maxMessages: readPositiveIntegerEnv(
      'CRADLE_CHAT_QUICK_QUESTION_MAX_MESSAGES',
      DEFAULT_QUICK_QUESTION_MAX_MESSAGES,
    ),
    maxChars: readPositiveIntegerEnv(
      'CRADLE_CHAT_QUICK_QUESTION_MAX_CHARS',
      DEFAULT_QUICK_QUESTION_MAX_CHARS,
    ),
  })

  return openDirectChunkStream(
    runtime.quickQuestion({
      runtimeSession: resolved.runtimeSession,
      profile: context.profile,
      question,
      transcript: transcript.history,
      workspaceId: context.session.workspaceId,
      workspacePath: context.workspacePath,
    }),
  )
}
