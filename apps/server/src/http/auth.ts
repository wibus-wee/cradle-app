import { createHash, timingSafeEqual } from 'node:crypto'

import { Elysia, t } from 'elysia'

import { loadServerAuthConfig } from '../config/server-config'
import { AppError } from '../errors/app-error'
import { issueBrowserAuthSession, verifyBrowserAuthSession } from './browser-auth-session'
import { OPENAPI_DOCS_PATH, OPENAPI_JSON_ALIAS_PATH, OPENAPI_JSON_PATH } from './openapi'
import { consumeSingleUseTicket, hasSingleUseTicket, issueSingleUseTicket } from './single-use-ticket'

export const CRADLE_RELAY_TOKEN_HEADER = 'x-cradle-relay-token'

interface AuthConfig {
  authRequired: boolean
  listRelayAuthTokens?: () => string[]
}

interface VerifyRequestTokenOptions {
  config?: AuthConfig
}

interface VerifyWebSocketRequestTokenOptions {
  config?: AuthConfig
  audience?: string
  consume?: boolean
}

const consumedWebSocketTicketRequests = new WeakMap<Request, string>()

function readAuthConfig(): AuthConfig {
  return loadServerAuthConfig()
}

function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest()
}

function tokenMatches(actual: string, expected: string): boolean {
  return timingSafeEqual(hashToken(actual), hashToken(expected))
}

function isPublicAuthPath(method: string, pathname: string): boolean {
  if (method !== 'GET' && method !== 'HEAD') {
    return false
  }

  return pathname === '/health'
    || pathname.startsWith('/api/plugins/-/deps/')
    || pathname === OPENAPI_JSON_PATH
    || pathname === OPENAPI_JSON_ALIAS_PATH
    || pathname === OPENAPI_DOCS_PATH
    || pathname.startsWith(`${OPENAPI_DOCS_PATH}/`)
}

export function createUnauthorizedError(): AppError {
  return new AppError({
    code: 'unauthorized',
    status: 401,
    message: 'Unauthorized',
  })
}

export function verifyRequestToken(
  headers: Headers,
  options: VerifyRequestTokenOptions = {},
): boolean {
  const config = options.config ?? readAuthConfig()
  if (!config.authRequired) {
    return true
  }

  const relayToken = headers.get(CRADLE_RELAY_TOKEN_HEADER)?.trim()
  return verifyBrowserAuthSession(headers)
    || Boolean(relayToken && readRelayAuthTokens(config).some(token => tokenMatches(relayToken, token)))
}

export function verifyWebSocketRequestToken(
  request: Request,
  options: VerifyWebSocketRequestTokenOptions = {},
): boolean {
  const url = new URL(request.url)
  const config = options.config ?? readAuthConfig()
  if (!config.authRequired) {
    return true
  }
  const ticket = url.searchParams.get('ticket')
  if (!ticket) {
    return false
  }
  const audience = options.audience ?? url.pathname
  if (options.consume === false) {
    return hasSingleUseTicket(ticket, audience)
  }

  if (consumedWebSocketTicketRequests.get(request) === audience) {
    return true
  }

  if (!consumeSingleUseTicket(ticket, audience)) {
    return false
  }

  // @elysiajs/node 1.4 invokes a WebSocket route's beforeHandle twice for the
  // same upgrade Request. Keep consumption idempotent within that request while
  // preserving single use across separate upgrade requests.
  consumedWebSocketTicketRequests.set(request, audience)
  return true
}

export function createAuthPlugin(config: AuthConfig = readAuthConfig()) {
  return new Elysia({ name: 'cradle.http.auth' })
    .onBeforeHandle({ as: 'global' }, ({ request }) => {
      const url = new URL(request.url)
      const { pathname } = url
      if (isPublicAuthPath(request.method, pathname)) {
        return undefined
      }

      const eventTicket = url.searchParams.get('eventTicket')
      if (
        request.method === 'GET'
        && eventTicket
        && consumeSingleUseTicket(eventTicket, `sse:${pathname}`)
      ) {
        return undefined
      }

      const resourceTicket = url.searchParams.get('resourceTicket')
      if (
        request.method === 'GET'
        && resourceTicket
        && consumeSingleUseTicket(resourceTicket, `resource:${pathname}`)
      ) {
        return undefined
      }

      if (
        request.method === 'GET'
        && request.headers.get('upgrade')?.toLowerCase() === 'websocket'
        && verifyWebSocketRequestToken(request, { config, audience: pathname, consume: false })
      ) {
        // Native browser WebSocket upgrades cannot send Authorization headers.
        // Leave ticket consumption to the matched WebSocket route so this global
        // hook does not consume the single-use ticket before route validation.
        return undefined
      }

      if (!verifyRequestToken(request.headers, { config })) {
        throw createUnauthorizedError()
      }

      return undefined
    })
    .post('/auth/websocket-ticket', ({ body }) => issueSingleUseTicket(body.audience), {
      detail: { summary: 'Issue a single-use WebSocket authentication ticket', tags: ['auth'] },
      body: t.Object({ audience: t.String({ minLength: 1, maxLength: 256 }) }),
      response: {
        200: t.Object({
          ticket: t.String(),
          expiresAt: t.Number(),
        }),
      },
    })
    .post('/auth/resource-ticket', ({ body }) => issueSingleUseTicket(`resource:${body.path}`), {
      detail: {
        summary: 'Issue a single-use browser resource authentication ticket',
        tags: ['auth'],
      },
      body: t.Object({
        path: t.String({ minLength: 1, maxLength: 512, pattern: '^/[^?#]*$' }),
      }),
      response: {
        200: t.Object({
          ticket: t.String(),
          expiresAt: t.Number(),
        }),
      },
    })
    .post('/auth/browser-session', ({ request, set }) => {
      set.headers['set-cookie'] = issueBrowserAuthSession(new URL(request.url).protocol === 'https:')
      return { ok: true as const }
    }, {
      detail: { summary: 'Bootstrap a browser authentication session', tags: ['auth'] },
      response: { 200: t.Object({ ok: t.Literal(true) }) },
    })
}

function readRelayAuthTokens(config: AuthConfig): string[] {
  try {
    return config.listRelayAuthTokens?.() ?? []
  }
  catch {
    return []
  }
}
