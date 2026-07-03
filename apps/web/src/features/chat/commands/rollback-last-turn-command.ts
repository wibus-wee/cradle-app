import { postChatSessionsBySessionIdRollbackLastTurn } from '~/api-gen/sdk.gen'
import type { PostChatSessionsBySessionIdRollbackLastTurnResponse } from '~/api-gen/types.gen'

import { readJsonErrorCodeFromText } from './chat-response-command'

export type RollbackLastTurnResult = PostChatSessionsBySessionIdRollbackLastTurnResponse

export interface RollbackLastTurnError {
  code: string | null
  status: number
  message: string
}

/**
 * Rolls back the last completed chat turn for a session.
 *
 * Throws an error augmented with `code` and `status` (read from the AppError
 * response body) so callers can map known preconditions — active run, queued
 * work, unsupported runtime, streaming tail — to friendly UI copy.
 */
export async function rollbackLastTurn(args: {
  sessionId: string
  signal?: AbortSignal
}): Promise<RollbackLastTurnResult> {
  const result = await postChatSessionsBySessionIdRollbackLastTurn({
    path: { sessionId: args.sessionId },
    signal: args.signal,
  })

  if (result.error || !result.data) {
    const body = stringifyRollbackError(result.error)
    const rollbackError = Object.assign(new Error(`Failed to roll back the last turn: ${result.response?.status ?? 'unknown'} ${body}`), {
      bodyText: body,
      code: readJsonErrorCodeFromText(body),
      status: result.response?.status ?? 0,
    }) as Error & RollbackLastTurnError
    throw rollbackError
  }

  return result.data
}

function stringifyRollbackError(error: unknown): string {
  if (typeof error === 'string') {
    return error
  }
  try {
    return JSON.stringify(error)
  }
  catch {
    return String(error)
  }
}

/** Maps a thrown rollback error code to a human-readable reason, if known. */
export function describeRollbackLastTurnError(error: unknown): string | null {
  if (!error || typeof error !== 'object') {
    return null
  }
  const code = (error as { code?: unknown }).code
  switch (code) {
    case 'chat_rollback_run_in_progress':
      return 'Wait for the active run to finish before editing the previous message.'
    case 'chat_rollback_queue_in_progress':
      return 'Clear the pending queue before editing the previous message.'
    case 'chat_rollback_streaming_tail':
      return 'The last turn is still streaming. Wait for it to finish first.'
    case 'chat_rollback_not_supported':
      return 'This runtime does not support editing the previous message.'
    case 'chat_rollback_projection_failed':
      return 'The provider rolled back, but Cradle could not update the transcript. The session may need recovery.'
    default:
      return null
  }
}
