import { createHash, timingSafeEqual } from 'node:crypto'

import { Elysia, t } from 'elysia'

import { loadServerAuthConfig } from '../config/server-config'
import { AppError } from '../errors/app-error'
import { issueBrowserAuthSession, verifyBrowserAuthSession } from './browser-auth-session'
import { OPENAPI_DOCS_PATH, OPENAPI_JSON_ALIAS_PATH, OPENAPI_JSON_PATH } from './openapi'
import { consumeWebSocketTicket, issueWebSocketTicket } from './websocket-ticket'

export const CRADLE_TOKEN_HEADER = 'x-cradle-token'
export const CRADLE_RELAY_TOKEN_HEADER = 'x-cradle-relay-token'

interface AuthConfig {
  authRequired: boolean
  authToken: string | null
  listRelayAuthTokens?: () => string[]
}

interface VerifyRequestTokenOptions {
  token?: string | null
  config?: AuthConfig
}

function readAuthConfig(): AuthConfig {
  const { authRequired, authToken } = loadServerAuthConfig()
  return { authRequired, authToken }
}

function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest()
}

function tokenMatches(actual: string, expected: string): boolean {
  return timingSafeEqual(hashToken(actual), hashToken(expected))
}

function readBearerToken(authorization: string | null): string | null {
  if (!authorization) {
    return null
  }

  const [scheme, ...parts] = authorization.trim().split(/\s+/)
  if (scheme?.toLowerCase() !== 'bearer' || parts.length !== 1) {
    return null
  }

  return parts[0] || null
}

function readPresentedToken(headers: Headers, options: VerifyRequestTokenOptions): string | null {
  return readBearerToken(headers.get('authorization'))
    ?? headers.get(CRADLE_TOKEN_HEADER)?.trim()
    ?? headers.get(CRADLE_RELAY_TOKEN_HEADER)?.trim()
    ?? options.token?.trim()
    ?? null
}

function isPublicAuthPath(method: string, pathname: string): boolean {
  if ((method === 'GET' || method === 'HEAD') && pathname === '/health') {
    return true
  }

  return pathname === OPENAPI_JSON_PATH
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

  const presentedToken = readPresentedToken(headers, options)
  if (!presentedToken) {
    return verifyBrowserAuthSession(headers)
  }

  if (config.authToken && tokenMatches(presentedToken, config.authToken)) {
    return true
  }

  return readRelayAuthTokens(config).some(token => tokenMatches(presentedToken, token))
    || verifyBrowserAuthSession(headers)
}

export function verifyWebSocketRequestToken(
  request: Request,
  options: Pick<VerifyRequestTokenOptions, 'config'> & { audience?: string } = {},
): boolean {
  const url = new URL(request.url)
  const config = options.config ?? readAuthConfig()
  if (!config.authRequired) {
    return true
  }
  const ticket = url.searchParams.get('ticket')
  return Boolean(ticket && consumeWebSocketTicket(ticket, options.audience ?? url.pathname))
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
        && consumeWebSocketTicket(eventTicket, `sse:${pathname}`)
      ) {
        return undefined
      }

      if (!verifyRequestToken(request.headers, { config })) {
        throw createUnauthorizedError()
      }

      return undefined
    })
    .post('/auth/websocket-ticket', ({ body }) => issueWebSocketTicket(body.audience), {
      detail: { summary: 'Issue a single-use WebSocket authentication ticket', tags: ['auth'] },
      body: t.Object({ audience: t.String({ minLength: 1, maxLength: 256 }) }),
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
