import { AppError } from '../../../errors/app-error'
import {
  buildRuntimeProviderInput,
  resolveRuntimeSessionContext,
} from '../runtime-session-context'

export async function cancelChatRuntimeTask(input: {
  sessionId: string
  taskId: string
}): Promise<{ ok: true }> {
  const resolved = await resolveRuntimeSessionContext(input.sessionId)
  if (!resolved.runtime.cancelRuntimeTask) {
    throw new AppError({
      code: 'chat_runtime_task_control_unsupported',
      status: 409,
      message: 'The selected runtime does not support task control',
      details: { sessionId: input.sessionId, runtimeKind: resolved.runtimeKind },
    })
  }
  await resolved.runtime.cancelRuntimeTask({
    ...buildRuntimeProviderInput(resolved),
    taskId: input.taskId,
  })
  return { ok: true }
}
