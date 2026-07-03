import { AppError } from '../../../errors/app-error'
import { getRuntimeRegistry } from '../chat-runtime-provider-registry'
import { openDirectChunkStream } from '../stream/sse'
import { readFullSessionTranscript } from '../transcript'
import {
  assertRunnableSession,
  assertRuntimeCompatibleTarget,
  resolveRuntimeSessionForContext
} from '../runtime-session-context'

export interface QuickQuestionInput {
  sessionId: string
  question: string
}

export async function streamQuickQuestion(
  input: QuickQuestionInput
): Promise<ReadableStream<Uint8Array>> {
  const context = assertRuntimeCompatibleTarget(assertRunnableSession(input.sessionId))
  const runtimeKind = context.session.runtimeKind ?? 'standard'
  const runtime = getRuntimeRegistry().get(runtimeKind)

  if (!runtime) {
    throw new AppError({
      code: 'chat_runtime_not_available',
      status: 501,
      message: `Runtime is not available: ${runtimeKind}`
    })
  }

  if (!runtime.quickQuestion) {
    throw new AppError({
      code: 'quick_question_not_supported',
      status: 409,
      message: 'This provider does not support quick questions',
      details: { runtimeKind }
    })
  }

  const question = input.question.trim()
  if (!question) {
    throw new AppError({
      code: 'chat_message_empty',
      status: 400,
      message: 'Quick question requires non-empty text'
    })
  }

  const resolved = await resolveRuntimeSessionForContext({
    sessionId: input.sessionId,
    context,
    runtimeKind,
    runtime
  })

  const transcript = await readFullSessionTranscript(input.sessionId)

  return openDirectChunkStream(
    runtime.quickQuestion({
      runtimeSession: resolved.runtimeSession,
      profile: context.profile,
      question,
      transcript,
      workspaceId: context.session.workspaceId,
      workspacePath: context.workspacePath
    })
  )
}
