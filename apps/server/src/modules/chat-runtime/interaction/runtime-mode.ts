import { AppError } from '../../../errors/app-error'
import {
  buildRuntimeProviderInput,
  resolveRuntimeSessionContext,
} from '../runtime-session-context'

export async function updateChatRuntimeMode(input: { sessionId: string, modeId: string }): Promise<{ ok: true }> {
  const resolved = await resolveRuntimeSessionContext(input.sessionId)
  if (!resolved.runtime.updateRuntimeMode) {
    throw new AppError({
      code: 'chat_runtime_mode_unsupported',
      status: 409,
      message: 'The selected runtime does not support session modes',
      details: { sessionId: input.sessionId, runtimeKind: resolved.runtimeKind },
    })
  }
  await resolved.runtime.updateRuntimeMode({
    ...buildRuntimeProviderInput(resolved),
    modeId: input.modeId,
  })
  return { ok: true }
}
