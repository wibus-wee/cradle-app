import type { RuntimeWarningPartData } from '@cradle/chat-runtime-contracts'
import type { UIMessage } from 'ai'

export type RuntimeWarningMessagePart = UIMessage['parts'][number] & {
  type: 'data-runtime-warning'
  data: RuntimeWarningPartData
}

export function isRuntimeWarningMessagePart(
  part: UIMessage['parts'][number] | undefined,
): part is RuntimeWarningMessagePart {
  if (part?.type !== 'data-runtime-warning') {
    return false
  }
  if (!part.data || typeof part.data !== 'object') {
    return false
  }
  const data = part.data as { message?: unknown, additionalDetails?: unknown }
  return (
    typeof data.message === 'string'
    && (data.additionalDetails === null || typeof data.additionalDetails === 'string')
  )
}
