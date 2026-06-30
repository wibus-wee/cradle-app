import { randomUUID } from 'node:crypto'

import { readOptionalObjectRecord as readRecord } from '../../../../helpers/json-record'
import { outboundFetch } from '../../../../lib/outbound-network'
import * as Secrets from '../../../secrets/service'

const CODEX_CREDENTIAL_LOGIN_TIMEOUT_MS = 10 * 60 * 1000
const CODEX_CREDENTIAL_POLL_INTERVAL_MS = 5_000
const CODEX_CHATGPT_AUTH_KIND = 'chatgpt-auth'
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const DEVICE_USER_CODE_URL = 'https://auth.openai.com/api/accounts/deviceauth/usercode'
const DEVICE_TOKEN_URL = 'https://auth.openai.com/api/accounts/deviceauth/token'
const DEVICE_VERIFICATION_URL = 'https://auth.openai.com/codex/device'
const DEVICE_REDIRECT_URI = 'https://auth.openai.com/deviceauth/callback'
const OPENAI_OAUTH_TOKEN_URL = 'https://auth.openai.com/oauth/token'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

let fetchForTests: FetchLike | null = null

interface PendingCodexChatgptCredentialLogin {
  loginId: string
  label: string
  deviceAuthId: string
  userCode: string
  startedAt: number
  expiresAtMs: number
  timeout: NodeJS.Timeout
  abortController: AbortController
  pollIntervalMs: number
  status: CodexChatgptCredentialLoginStatus
}

interface DeviceUserCodeResponse {
  device_auth_id?: unknown
  device_code?: unknown
  user_code?: unknown
  verification_uri?: unknown
  verification_url?: unknown
  verification_uri_complete?: unknown
  expires_in?: unknown
  expires_at?: unknown
  interval?: unknown
  error?: unknown
  error_description?: unknown
}

interface DeviceTokenResponse {
  authorization_code?: unknown
  code_verifier?: unknown
  code?: unknown
  access_token?: unknown
  refresh_token?: unknown
  error?: unknown
  error_description?: unknown
}

interface OAuthTokenResponse {
  access_token?: unknown
  refresh_token?: unknown
  id_token?: unknown
}

export interface CodexChatgptCredentialLoginStartResponse {
  loginId: string
  verificationUrl: string
  userCode: string
  expiresAt: number
}

export interface CodexChatgptCredentialLoginStatus {
  loginId: string
  state: 'pending' | 'completed' | 'failed' | 'cancelled'
  startedAt: number
  completedAt: number | null
  credentialRef: string | null
  email: string | null
  planType: string | null
  error: string | null
}

const pendingLogins = new Map<string, PendingCodexChatgptCredentialLogin>()
const completedLogins = new Map<string, CodexChatgptCredentialLoginStatus>()

export async function startCodexChatgptCredentialLogin(input: {
  label?: string | null
} = {}): Promise<CodexChatgptCredentialLoginStartResponse> {
  const response = await postDeviceAuthJson<DeviceUserCodeResponse>(DEVICE_USER_CODE_URL, {
    client_id: CODEX_CLIENT_ID,
  })

  const deviceAuthId = readString(response.device_auth_id) ?? readString(response.device_code)
  const userCode = readString(response.user_code)
  const verificationUrl = readString(response.verification_uri_complete)
    ?? readString(response.verification_uri)
    ?? readString(response.verification_url)
    ?? DEVICE_VERIFICATION_URL
  if (!deviceAuthId || !userCode) {
    throw new Error(readDeviceAuthErrorMessage(response) ?? 'Codex ChatGPT device auth response is missing device code details')
  }

  const loginId = randomUUID()
  const startedAt = Math.floor(Date.now() / 1000)
  const expiresAtMs = readTimestampMs(response.expires_at)
    ?? (Date.now() + Math.max(1, readNumberLike(response.expires_in) ?? 900) * 1000)
  const expiresInMs = Math.max(1, expiresAtMs - Date.now())
  const timeoutMs = Math.min(expiresInMs, CODEX_CREDENTIAL_LOGIN_TIMEOUT_MS)
  const expiresAt = Math.floor((Date.now() + timeoutMs) / 1000)
  const abortController = new AbortController()
  const timeout = setTimeout(() => {
    completePendingLogin(loginId, {
      state: 'failed',
      error: 'Codex ChatGPT login timed out',
    })
  }, timeoutMs)
  const pending: PendingCodexChatgptCredentialLogin = {
    loginId,
    label: input.label?.trim() || 'Codex ChatGPT account',
    deviceAuthId,
    userCode,
    startedAt,
    expiresAtMs,
    timeout,
    abortController,
    pollIntervalMs: Math.max(1, readNumberLike(response.interval) ?? CODEX_CREDENTIAL_POLL_INTERVAL_MS / 1000) * 1000,
    status: {
      loginId,
      state: 'pending',
      startedAt,
      completedAt: null,
      credentialRef: null,
      email: null,
      planType: null,
      error: null,
    },
  }
  pendingLogins.set(loginId, pending)
  void pollPendingLogin(pending)

  return {
    loginId,
    verificationUrl,
    userCode,
    expiresAt,
  }
}

export function readCodexChatgptCredentialLoginStatus(loginId: string): CodexChatgptCredentialLoginStatus {
  const pending = pendingLogins.get(loginId)
  if (pending) {
    return pending.status
  }
  const completed = completedLogins.get(loginId)
  if (completed) {
    return completed
  }
  throw new Error('Codex ChatGPT credential login not found')
}

export function cancelCodexChatgptCredentialLogin(loginId: string): { ok: true } {
  completePendingLogin(loginId, {
    state: 'cancelled',
    error: null,
  })
  return { ok: true }
}

export function setCodexChatgptCredentialLoginFetchForTests(fetchImpl: FetchLike | null): void {
  clearAllLogins()
  fetchForTests = fetchImpl
}

async function pollPendingLogin(pending: PendingCodexChatgptCredentialLogin): Promise<void> {
  try {
    while (pendingLogins.get(pending.loginId) === pending) {
      if (pending.expiresAtMs <= Date.now()) {
        completePendingLogin(pending.loginId, {
          state: 'failed',
          error: 'Codex ChatGPT login timed out',
        })
        return
      }
      const response = await postDeviceAuthJson<DeviceTokenResponse>(DEVICE_TOKEN_URL, {
        client_id: CODEX_CLIENT_ID,
        device_auth_id: pending.deviceAuthId,
        user_code: pending.userCode,
      }, pending.abortController.signal)

      const error = readString(response.error)
      if (error === 'authorization_pending') {
        await delay(pending.pollIntervalMs, pending.abortController.signal)
        continue
      }
      if (error === 'slow_down') {
        pending.pollIntervalMs += CODEX_CREDENTIAL_POLL_INTERVAL_MS
        await delay(pending.pollIntervalMs, pending.abortController.signal)
        continue
      }
      if (error) {
        completePendingLogin(pending.loginId, {
          state: 'failed',
          error: readDeviceAuthErrorMessage(response) ?? `Codex ChatGPT login failed: ${error}`,
        })
        return
      }

      const credential = await createCredentialFromDeviceTokenResponse(pending, response)
      completePendingLogin(pending.loginId, {
        state: 'completed',
        credentialRef: credential.credentialRef,
        email: credential.email,
        planType: credential.planType,
      })
      return
    }
  }
  catch (error) {
    if (pending.abortController.signal.aborted) {
      return
    }
    completePendingLogin(pending.loginId, {
      state: 'failed',
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

async function createCredentialFromDeviceTokenResponse(
  pending: PendingCodexChatgptCredentialLogin,
  response: DeviceTokenResponse,
): Promise<{ credentialRef: string, email: string | null, planType: string | null }> {
  const authorizationCode = readString(response.authorization_code) ?? readString(response.code)
  const codeVerifier = readString(response.code_verifier)
  const directAccessToken = readString(response.access_token)
  const directRefreshToken = readString(response.refresh_token)
  const tokens = authorizationCode
    ? await exchangeAuthorizationCode(authorizationCode, codeVerifier, pending.abortController.signal)
    : { access_token: directAccessToken, refresh_token: directRefreshToken }

  const accessToken = readString(tokens.access_token)
  const refreshToken = readString(tokens.refresh_token)
  if (!accessToken) {
    throw new Error('Codex ChatGPT login completed without an access token')
  }
  if (!refreshToken) {
    throw new Error('Codex ChatGPT login completed without a refresh token')
  }

  const claims = readJwtClaims(accessToken) ?? readJwtClaims(readString(tokens.id_token))
  const authClaims = readRecord(claims?.['https://api.openai.com/auth'])
  const chatgptAccountId = readString(authClaims?.chatgpt_account_id)
    ?? readString(claims?.chatgpt_account_id)
  if (!chatgptAccountId) {
    throw new Error('Codex ChatGPT auth token is missing chatgpt_account_id')
  }
  const chatgptPlanType = normalizePlanType(
    readString(authClaims?.chatgpt_plan_type)
    ?? readString(claims?.chatgpt_plan_type),
  )
  const email = readString(claims?.email)

  const metadata = Secrets.saveSecret({
    kind: CODEX_CHATGPT_AUTH_KIND,
    label: pending.label,
    secret: JSON.stringify({
      kind: CODEX_CHATGPT_AUTH_KIND,
      accessToken,
      refreshToken,
      chatgptAccountId,
      chatgptPlanType,
      updatedAt: Date.now(),
    }),
  })

  return {
    credentialRef: metadata.id,
    email,
    planType: chatgptPlanType,
  }
}

async function exchangeAuthorizationCode(
  authorizationCode: string,
  codeVerifier: string | null,
  signal: AbortSignal,
): Promise<OAuthTokenResponse> {
  if (!codeVerifier) {
    throw new Error('Codex ChatGPT login completed without a code verifier')
  }
  return postForm<OAuthTokenResponse>(OPENAI_OAUTH_TOKEN_URL, {
    grant_type: 'authorization_code',
    code: authorizationCode,
    redirect_uri: DEVICE_REDIRECT_URI,
    client_id: CODEX_CLIENT_ID,
    code_verifier: codeVerifier,
  }, signal)
}

function completePendingLogin(
  loginId: string,
  patch: Partial<Omit<CodexChatgptCredentialLoginStatus, 'loginId' | 'startedAt'>>,
): void {
  const pending = pendingLogins.get(loginId)
  if (!pending) {
    return
  }
  clearTimeout(pending.timeout)
  pending.abortController.abort()
  pendingLogins.delete(loginId)
  completedLogins.set(loginId, {
    ...pending.status,
    ...patch,
    completedAt: Math.floor(Date.now() / 1000),
  })
}

function clearAllLogins(): void {
  for (const pending of pendingLogins.values()) {
    clearTimeout(pending.timeout)
    pending.abortController.abort()
  }
  pendingLogins.clear()
  completedLogins.clear()
}

async function postForm<T>(
  url: string,
  body: Record<string, string>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await getFetch()(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'cradle-codex-chatgpt-auth',
    },
    body: new URLSearchParams(body),
    signal,
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Codex ChatGPT auth request failed: ${response.status} ${text}`.trim())
  }
  return response.json() as Promise<T>
}

async function postDeviceAuthJson<T>(
  url: string,
  body: Record<string, string>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await getFetch()(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'cradle-codex-chatgpt-auth',
    },
    body: JSON.stringify(body),
    signal,
  })
  const text = await response.text().catch(() => '')
  const parsed = parseJsonObject(text)
  if (!response.ok && (response.status === 403 || response.status === 404)) {
    return { error: 'authorization_pending' } as T
  }
  if (!response.ok && response.status === 410) {
    return { error: 'expired_token' } as T
  }
  if (!response.ok && !readString(parsed?.error)) {
    throw new Error(`Codex ChatGPT auth request failed: ${response.status} ${text}`.trim())
  }
  if (!parsed) {
    throw new Error('Codex ChatGPT auth response is not valid JSON')
  }
  return parsed as T
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(raw)
    return readRecord(value)
  }
  catch {
    return null
  }
}

function getFetch(): FetchLike {
  return fetchForTests ?? outboundFetch
}

function readDeviceAuthErrorMessage(response: DeviceUserCodeResponse | DeviceTokenResponse): string | null {
  const error = readString(response.error)
  if (!error) {
    return null
  }
  const description = readString(response.error_description)
  return description
    ? `Codex ChatGPT device auth failed: ${error}: ${description}`
    : `Codex ChatGPT device auth failed: ${error}`
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(new Error('Codex ChatGPT login was cancelled'))
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timeout)
      reject(new Error('Codex ChatGPT login was cancelled'))
    }, { once: true })
  })
}

function readJwtClaims(token: string | null): Record<string, unknown> | null {
  if (!token) {
    return null
  }
  const parts = token.split('.')
  if (parts.length < 2) {
    return null
  }
  try {
    const payload = parts[1]!
    const padded = payload.padEnd(payload.length + ((4 - payload.length % 4) % 4), '=')
    return JSON.parse(Buffer.from(padded, 'base64url').toString('utf8')) as Record<string, unknown>
  }
  catch {
    return null
  }
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function readNumberLike(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function readTimestampMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000
  }
  if (typeof value !== 'string' || !value.trim()) {
    return null
  }
  const numeric = Number(value)
  if (Number.isFinite(numeric)) {
    return numeric > 10_000_000_000 ? numeric : numeric * 1000
  }
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizePlanType(value: string | null): string | null {
  return value?.trim().toLowerCase() || null
}
