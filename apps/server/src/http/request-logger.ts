import { Elysia } from 'elysia'
import { z } from 'zod'

import { createChildLogger } from '../logging/logger'
import { record } from '../modules/observability/service'
import { REQUEST_ID_HEADER } from './request-id'

const SLOW_REQUEST_THRESHOLD_MS = 3000
const ResponseSetSchema = z.object({
  status: z.number().default(200),
}).passthrough()

export function createRequestLoggerPlugin() {
  return new Elysia({ name: 'cradle.http.request-logger' })
    .derive(({ request, set }) => {
      const requestId = set.headers[REQUEST_ID_HEADER] as string
        ?? request.headers.get(REQUEST_ID_HEADER)
        ?? 'unknown'
      return {
        requestLogger: createChildLogger({ requestId }),
        requestStartTime: performance.now(),
      }
    })
    .onAfterResponse(({ request, set, requestLogger, requestStartTime }) => {
      const duration = Math.round(performance.now() - (requestStartTime ?? 0))
      const url = new URL(request.url)
      const status = ResponseSetSchema.parse(set).status

      requestLogger.info('request completed', {
        method: request.method,
        path: url.pathname,
        status,
        durationMs: duration,
      })

      if (duration > SLOW_REQUEST_THRESHOLD_MS) {
        record({
          source: 'http',
          code: 'http.slow_request',
          severity: 'warn',
          category: 'performance',
          message: `Slow request: ${request.method} ${url.pathname} took ${duration}ms`,
          attrs: {
            method: request.method,
            path: url.pathname,
            status,
            durationMs: duration,
          },
        })
      }
    })
}
