import type { UIMessageChunk } from 'ai'

import { AppError } from '../../../errors/app-error'
import { createDedupeKey, OBSERVABILITY_CODES } from '../../observability/contract'
import * as Observability from '../../observability/service'
import type { RuntimeKind } from '../../provider-contracts/types'
import { ProviderRuntimeError } from '../runtime-provider-types'

export interface SerializedChatError {
  text: string
  payload: {
    name?: string
    message: string
    code?: number | string
    data?: unknown
    stack?: string
  }
}

export function resolveTurnFailureObservabilityCode(chunk: UIMessageChunk): string {
  if (chunk.type !== 'error') {
    return OBSERVABILITY_CODES.turnStreamFailed
  }

  if (chunk.errorText.includes('without any assistant output')) {
    return OBSERVABILITY_CODES.chatEmptyOutputCompletion
  }

  return OBSERVABILITY_CODES.turnStreamFailed
}

export function createSessionTitleGenerationError(input: {
  sessionId: string
  runtimeKind: RuntimeKind
  providerTargetId: string | null
  reason?: string
  error?: unknown
}): AppError {
  const providerError
    = input.error instanceof ProviderRuntimeError ? input.error.providerError : null
  const errorDetails = input.error === undefined ? null : serializeTitleGenerationError(input.error)
  const failureReason = input.reason ?? providerError?._tag ?? 'provider_error'
  const message = errorDetails?.message
    ? `Runtime could not generate a session title: ${errorDetails.message}`
    : 'Runtime could not generate a session title'

  Observability.record({
    source: 'chat-engine',
    code: OBSERVABILITY_CODES.chatSessionTitleGenerationFailed,
    severity: 'error',
    category: 'chat',
    message,
    chatSessionId: input.sessionId,
    dedupeKey: createDedupeKey({
      code: OBSERVABILITY_CODES.chatSessionTitleGenerationFailed,
      chatSessionId: input.sessionId,
      runId: null,
    }),
    attrs: {
      runtimeKind: input.runtimeKind,
      providerTargetId: input.providerTargetId,
      reason: failureReason,
      ...(providerError ? { providerError } : {}),
      ...(errorDetails ? { error: errorDetails } : {}),
    },
  })

  return new AppError({
    code: 'chat_session_title_generation_failed',
    status: 502,
    message,
    details: {
      sessionId: input.sessionId,
      runtimeKind: input.runtimeKind,
      providerTargetId: input.providerTargetId,
      reason: failureReason,
      ...(providerError ? { providerError } : {}),
      ...(errorDetails ? { error: omitTitleGenerationErrorStack(errorDetails) } : {}),
    },
  })
}

export function serializeChatError(error: unknown): SerializedChatError {
  if (error instanceof ProviderRuntimeError) {
    return serializeProviderRuntimeError(error)
  }

  const payload: SerializedChatError['payload'] = {
    message: error instanceof Error ? error.message : String(error),
  }

  if (error instanceof Error) {
    payload.name = error.name
    payload.stack = error.stack
  }

  if (error && typeof error === 'object') {
    const candidate = error as { code?: unknown, data?: unknown }
    if (typeof candidate.code === 'string' || typeof candidate.code === 'number') {
      payload.code = candidate.code
    }
    if ('data' in candidate) {
      payload.data = candidate.data
    }
  }

  const detailText = formatErrorDetails(payload.data)
  const codePrefix = payload.code !== undefined ? `[code ${String(payload.code)}] ` : ''
  const text = detailText
    ? `${codePrefix}${payload.message}: ${detailText}`
    : `${codePrefix}${payload.message}`

  return { text, payload }
}

function serializeTitleGenerationError(error: unknown): {
  name?: string
  message: string
  code?: string | number
  data?: unknown
  stack?: string
} {
  const output: {
    name?: string
    message: string
    code?: string | number
    data?: unknown
    stack?: string
  } = {
    message: error instanceof Error ? error.message : String(error),
  }

  if (error instanceof Error) {
    output.name = error.name
    output.stack = error.stack
  }
  if (error && typeof error === 'object') {
    const candidate = error as { code?: unknown, data?: unknown }
    if (typeof candidate.code === 'string' || typeof candidate.code === 'number') {
      output.code = candidate.code
    }
    if ('data' in candidate) {
      output.data = candidate.data
    }
  }
  return output
}

function omitTitleGenerationErrorStack(
  error: ReturnType<typeof serializeTitleGenerationError>,
): Omit<ReturnType<typeof serializeTitleGenerationError>, 'stack'> {
  const { stack: _stack, ...safeError } = error
  return safeError
}

function serializeProviderRuntimeError(error: ProviderRuntimeError): SerializedChatError {
  const providerError = error.providerError
  const payload: SerializedChatError['payload'] = {
    name: error.name,
    message: error.message,
    code: providerError._tag,
    data: providerError,
    stack: error.stack,
  }

  return {
    text: formatProviderRuntimeErrorText(providerError),
    payload,
  }
}

function formatProviderRuntimeErrorText(error: ProviderRuntimeError['providerError']): string {
  switch (error._tag) {
    case 'provider_unsupported':
      return `Provider is unsupported: ${error.provider}`
    case 'session_not_found':
      return `Provider session was not found: ${error.provider}/${error.sessionId}`
    case 'session_closed':
      return `Provider session is closed: ${error.provider}/${error.sessionId}`
    case 'request_failed':
      return `${error.provider} request failed in ${error.method}: ${error.detail}`
    case 'process_error':
      return `${error.provider} process error: ${error.detail}`
    case 'auth_failed':
      return `${error.provider} authentication failed`
    case 'rate_limited':
      return error.retryAfter === undefined
        ? `${error.provider} is rate limited`
        : `${error.provider} is rate limited; retry after ${error.retryAfter}s`
    case 'model_not_found':
      return `${error.provider} model was not found: ${error.model}`
  }
}

function formatErrorDetails(data: unknown): string | null {
  if (data === null || data === undefined) {
    return null
  }
  if (typeof data === 'object' && data !== null && 'details' in data) {
    return stringifyErrorValue((data as { details: unknown }).details)
  }
  return stringifyErrorValue(data)
}

function stringifyErrorValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value === 'string') {
    return value
  }
  try {
    return JSON.stringify(value)
  }
 catch {
    return String(value)
  }
}
