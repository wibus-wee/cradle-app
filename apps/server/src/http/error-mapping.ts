import type { ErrorHandler } from 'elysia'

import { AppError } from '../errors/app-error'
import { getLogger } from '../logging/logger'
import { OBSERVABILITY_CODES } from '../modules/observability/contract'
import { record } from '../modules/observability/service'
import { normalizeValidationError } from './validation'

function createJsonErrorResponse(
  headers: Record<string, string | number | undefined>,
  status: number,
  body: Record<string, unknown>,
): Response {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, String(value)]),
  )

  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...normalizedHeaders,
      'content-type': 'application/json',
    },
  })
}

export function createErrorHandler(): ErrorHandler {
  return ({ code, error, request, set }) => {
    if (error instanceof AppError) {
      return createJsonErrorResponse(set.headers, error.status, {
        code: error.code,
        message: error.message,
        details: error.details,
      })
    }

    if (code === 'VALIDATION') {
      const normalized = normalizeValidationError(error, {
        code: 'validation_error',
        message: 'request validation failed',
      })
      return createJsonErrorResponse(set.headers, normalized.status, normalized.body)
    }

    if (code === 'NOT_FOUND') {
      return createJsonErrorResponse(set.headers, 404, {
        code: 'not_found',
        message: 'Not Found',
      })
    }

    getLogger().error('unhandled error', { err: error })
    record({
      source: 'http',
      code: OBSERVABILITY_CODES.httpUnhandledError,
      severity: 'error',
      category: 'system',
      message: 'Unhandled HTTP request error',
      attrs: {
        method: request.method,
        path: new URL(request.url).pathname,
        error: error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : { value: String(error) },
      },
    })
    return createJsonErrorResponse(set.headers, 500, {
      code: 'internal_server_error',
      message: 'Internal Server Error',
    })
  }
}
