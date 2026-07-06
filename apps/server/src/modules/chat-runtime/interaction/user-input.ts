import { AppError } from '../../../errors/app-error'
import { submitRuntimeUserInput } from '../pending-user-input'
import type { RuntimeUserInputResolution } from '../runtime-provider-types'
import {
  buildRuntimeProviderInput,
  resolveRuntimeSessionContext,
} from '../runtime-session-context'

export interface SubmitChatRuntimeUserInputInput {
  sessionId: string
  requestId: string
  answers: Record<string, string[]>
}

export async function submitChatRuntimeUserInput(
  input: SubmitChatRuntimeUserInputInput,
): Promise<RuntimeUserInputResolution> {
  try {
    return await submitRuntimeUserInput(input)
  }
 catch (error) {
    if (!(error instanceof AppError) || error.code !== 'chat_runtime_user_input_not_found') {
      throw error
    }
  }

  const resolved = await resolveRuntimeSessionContext(input.sessionId)
  if (!resolved.runtime.submitUserInput) {
    throw new AppError({
      code: 'chat_runtime_user_input_not_found',
      status: 404,
      message: 'Pending runtime user input request was not found',
      details: { requestId: input.requestId, sessionId: input.sessionId },
    })
  }

  const resolution = await resolved.runtime.submitUserInput({
    ...buildRuntimeProviderInput(resolved),
    requestId: input.requestId,
    answers: input.answers,
  })
  if (!resolution) {
    throw new AppError({
      code: 'chat_runtime_user_input_not_found',
      status: 404,
      message: 'Pending runtime user input request was not found',
      details: {
        requestId: input.requestId,
        sessionId: input.sessionId,
        runtimeKind: resolved.runtimeKind,
        providerSessionId: resolved.runtimeSession.providerSessionId,
      },
    })
  }
  return resolution
}
