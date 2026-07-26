import { randomUUID } from 'node:crypto'

import { loadGitHubAppConfig } from '../../config/github-app'
import { AppError } from '../../errors/app-error'
import type { GitHubAuthIdentity } from '../../lib/github/auth-provider'
import { clearGitHubReadInFlight } from '../../lib/github/cache-gate'
import { resetGitHubClientState } from '../../lib/github/client'
import { outboundFetch } from '../../lib/outbound-network'
import * as Secrets from '../secrets/service'

const GITHUB_APP_CREDENTIAL_ID = 'system:github-app-user'
const GITHUB_APP_CREDENTIAL_KIND = 'system-github-app-user'
const GITHUB_APP_CREDENTIAL_VERSION = 1
const GITHUB_DEVICE_CODE_URL = 'https://github.com/login/device/code'
const GITHUB_ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token'
const GITHUB_USER_URL = 'https://api.github.com/user'
const REFRESH_WINDOW_SECONDS = 5 * 60
const SLOW_DOWN_SECONDS = 5

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

interface GitHubViewer {
  login: string
  avatarUrl: string | null
  profileUrl: string | null
}

interface GitHubAppCredential {
  version: number
  identityVersion: string
  accessToken: string
  refreshToken: string | null
  expiresAt: number | null
  refreshTokenExpiresAt: number | null
  viewer: GitHubViewer | null
  updatedAt: number
  lastError: string | null
}

interface PendingLogin {
  loginId: string
  deviceCode: string
  userCode: string
  verificationUri: string
  startedAt: number
  expiresAt: number
  pollIntervalSeconds: number
  abortController: AbortController
  timeout: NodeJS.Timeout
  status: GitHubDeviceLoginStatus
}

interface DeviceCodeResponse {
  device_code?: string
  user_code?: string
  verification_uri?: string
  verification_uri_complete?: string
  expires_in?: number
  interval?: number
  error?: string
  error_description?: string
}

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  refresh_token_expires_in?: number
  error?: string
  error_description?: string
}

interface UserResponse {
  login?: string
  avatar_url?: string
  html_url?: string
}

export interface GitHubDeviceLoginStart {
  loginId: string
  verificationUri: string
  userCode: string
  expiresAt: number
  pollInterval: number
}

export interface GitHubDeviceLoginStatus {
  loginId: string
  state: 'pending' | 'completed' | 'failed' | 'cancelled'
  startedAt: number
  completedAt: number | null
  error: string | null
}

export interface GitHubAppConnectionView {
  state: 'unconfigured' | 'disconnected' | 'pending' | 'connected' | 'expired' | 'error'
  appName: string | null
  appSlug: string | null
  installationUrl: string | null
  viewer: GitHubViewer | null
  expiresAt: number | null
  refreshTokenExpiresAt: number | null
  error: string | null
}

let fetchForTests: FetchLike | null = null
const pendingLogins = new Map<string, PendingLogin>()
const finishedLogins = new Map<string, GitHubDeviceLoginStatus>()

export async function getGitHubAppConnection(): Promise<GitHubAppConnectionView> {
  const config = loadGitHubAppConfig()
  if (!config.clientId || !config.slug) {
    return {
      state: 'unconfigured',
      appName: null,
      appSlug: null,
      installationUrl: null,
      viewer: null,
      expiresAt: null,
      refreshTokenExpiresAt: null,
      error: 'GitHub App is not configured in this build.',
    }
  }

  const pending = [...pendingLogins.values()][0]
  if (pending) {
    return {
      state: 'pending',
      appName: config.name,
      appSlug: config.slug,
      installationUrl: installationUrl(config.slug),
      viewer: null,
      expiresAt: pending.expiresAt,
      refreshTokenExpiresAt: null,
      error: null,
    }
  }

  const credential = readCredential()
  if (!credential) {
    return baseConnection(config, 'disconnected')
  }
  const expired = isExpired(credential.expiresAt)
  return {
    state: expired ? 'expired' : credential.lastError ? 'error' : 'connected',
    appName: config.name,
    appSlug: config.slug,
    installationUrl: installationUrl(config.slug),
    viewer: credential.viewer,
    expiresAt: credential.expiresAt,
    refreshTokenExpiresAt: credential.refreshTokenExpiresAt,
    error: expired
      ? 'Your GitHub connection has expired. Connect again to continue.'
      : credential.lastError,
  }
}

export async function startGitHubDeviceLogin(): Promise<GitHubDeviceLoginStart> {
  const config = requireConfig()
  if (pendingLogins.size > 0) {
    throw new AppError({
      code: 'github_device_login_active',
      status: 409,
      message: 'A GitHub connection is already waiting for authorization.',
    })
  }

  const response = await postForm<DeviceCodeResponse>(GITHUB_DEVICE_CODE_URL, {
    client_id: config.clientId,
  })
  if (response.error) {
    throw new AppError({
      code: 'github_device_login_unavailable',
      status: 502,
      message: response.error_description ?? 'GitHub could not start device authorization.',
    })
  }
  if (!response.device_code || !response.user_code || !response.verification_uri) {
    throw new AppError({
      code: 'github_device_login_unavailable',
      status: 502,
      message: 'GitHub returned an incomplete device authorization response.',
    })
  }

  const startedAt = now()
  const expiresAt = startedAt + Math.max(1, response.expires_in ?? 900)
  const loginId = randomUUID()
  const abortController = new AbortController()
  const timeout = setTimeout(() => {
    completeLogin(loginId, { state: 'failed', error: 'GitHub device authorization expired.' })
  }, Math.max(1, expiresAt - now()) * 1000)
  timeout.unref()
  const pending: PendingLogin = {
    loginId,
    deviceCode: response.device_code,
    userCode: response.user_code,
    verificationUri: response.verification_uri_complete ?? response.verification_uri,
    startedAt,
    expiresAt,
    pollIntervalSeconds: Math.max(1, response.interval ?? 5),
    abortController,
    timeout,
    status: {
      loginId,
      state: 'pending',
      startedAt,
      completedAt: null,
      error: null,
    },
  }
  pendingLogins.set(loginId, pending)
  void pollLogin(pending)
  return {
    loginId,
    verificationUri: pending.verificationUri,
    userCode: pending.userCode,
    expiresAt,
    pollInterval: pending.pollIntervalSeconds,
  }
}

export function getGitHubDeviceLogin(loginId: string): GitHubDeviceLoginStatus {
  const pending = pendingLogins.get(loginId)
  if (pending) {
    return pending.status
  }
  const finished = finishedLogins.get(loginId)
  if (finished) {
    return finished
  }
  throw new AppError({
    code: 'github_device_login_not_found',
    status: 404,
    message: 'GitHub device authorization was not found.',
  })
}

export function cancelGitHubDeviceLogin(loginId: string): { ok: true } {
  if (!pendingLogins.has(loginId)) {
    throw new AppError({
      code: 'github_device_login_not_found',
      status: 404,
      message: 'GitHub device authorization was not found.',
    })
  }
  completeLogin(loginId, { state: 'cancelled', error: null })
  return { ok: true }
}

export function disconnectGitHubApp(): { ok: true } {
  Secrets.removeSecret(GITHUB_APP_CREDENTIAL_ID)
  invalidateGitHubIdentity()
  return { ok: true }
}

export async function resolveGitHubAppIdentity(): Promise<GitHubAuthIdentity | null> {
  const config = loadGitHubAppConfig()
  if (!config.clientId || !config.slug) {
    return null
  }
  const credential = readCredential()
  if (!credential) {
    return null
  }

  const activeCredential = needsRefresh(credential)
    ? await refreshCredential(config.clientId, credential)
    : credential
  if (isExpired(activeCredential.expiresAt)) {
    throw expiredConnectionError()
  }
  return {
    accessToken: activeCredential.accessToken,
    cacheKey: `github-app-user:${activeCredential.identityVersion}`,
    source: 'github-app',
  }
}

export function setGitHubAuthFetchForTests(fetchImpl: FetchLike | null): void {
  clearPendingLogins()
  fetchForTests = fetchImpl
}

async function pollLogin(pending: PendingLogin): Promise<void> {
  try {
    while (pendingLogins.get(pending.loginId) === pending) {
      if (pending.expiresAt <= now()) {
        completeLogin(pending.loginId, { state: 'failed', error: 'GitHub device authorization expired.' })
        return
      }
      const response = await postForm<TokenResponse>(GITHUB_ACCESS_TOKEN_URL, {
        client_id: requireConfig().clientId,
        device_code: pending.deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }, pending.abortController.signal)
      if (response.error === 'authorization_pending') {
        await wait(pending.pollIntervalSeconds * 1000, pending.abortController.signal)
        continue
      }
      if (response.error === 'slow_down') {
        pending.pollIntervalSeconds += SLOW_DOWN_SECONDS
        await wait(pending.pollIntervalSeconds * 1000, pending.abortController.signal)
        continue
      }
      if (response.error) {
        completeLogin(pending.loginId, {
          state: 'failed',
          error: response.error_description ?? `GitHub device authorization failed: ${response.error}`,
        })
        return
      }
      if (!response.access_token) {
        completeLogin(pending.loginId, { state: 'failed', error: 'GitHub did not return an access token.' })
        return
      }
      const credential = await credentialFromTokenResponse(response)
      writeCredential(credential)
      completeLogin(pending.loginId, { state: 'completed', error: null })
      return
    }
  }
  catch (error) {
    if (!pending.abortController.signal.aborted) {
      completeLogin(pending.loginId, {
        state: 'failed',
        error: error instanceof Error ? error.message : 'GitHub device authorization failed.',
      })
    }
  }
}

async function refreshCredential(clientId: string, credential: GitHubAppCredential): Promise<GitHubAppCredential> {
  if (!credential.refreshToken || isExpired(credential.refreshTokenExpiresAt)) {
    throw expiredConnectionError()
  }
  let response: TokenResponse
  try {
    response = await postForm<TokenResponse>(GITHUB_ACCESS_TOKEN_URL, {
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: credential.refreshToken,
    })
  }
  catch {
    throw expiredConnectionError()
  }
  if (response.error || !response.access_token) {
    writeCredential({ ...credential, lastError: 'GitHub rejected the saved connection. Connect again to continue.', updatedAt: now() })
    throw expiredConnectionError()
  }
  const refreshed = await credentialFromTokenResponse(response, credential.viewer)
  writeCredential(refreshed)
  return refreshed
}

async function credentialFromTokenResponse(response: TokenResponse, existingViewer: GitHubViewer | null = null): Promise<GitHubAppCredential> {
  const accessToken = response.access_token
  if (!accessToken) {
    throw expiredConnectionError()
  }
  const currentTime = now()
  const viewer = await fetchViewer(accessToken)
  return {
    version: GITHUB_APP_CREDENTIAL_VERSION,
    identityVersion: randomUUID(),
    accessToken,
    refreshToken: response.refresh_token ?? null,
    expiresAt: response.expires_in ? currentTime + response.expires_in : null,
    refreshTokenExpiresAt: response.refresh_token_expires_in ? currentTime + response.refresh_token_expires_in : null,
    viewer: viewer ?? existingViewer,
    updatedAt: currentTime,
    lastError: null,
  }
}

async function fetchViewer(accessToken: string): Promise<GitHubViewer> {
  const response = await fetchImpl()(GITHUB_USER_URL, {
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${accessToken}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  const payload = await response.json() as UserResponse
  if (!response.ok || !payload.login) {
    throw new AppError({
      code: 'github_device_login_unavailable',
      status: 502,
      message: 'GitHub could not verify the connected user.',
    })
  }
  return {
    login: payload.login,
    avatarUrl: payload.avatar_url ?? null,
    profileUrl: payload.html_url ?? null,
  }
}

async function postForm<T>(url: string, body: Record<string, string>, signal?: AbortSignal): Promise<T> {
  const response = await fetchImpl()(url, {
    method: 'POST',
    signal,
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body).toString(),
  })
  const payload = await response.json() as T
  if (!response.ok) {
    throw new AppError({
      code: 'github_device_login_unavailable',
      status: 502,
      message: 'GitHub device authorization is unavailable.',
    })
  }
  return payload
}

function readCredential(): GitHubAppCredential | null {
  try {
    const raw = Secrets.readSecret(GITHUB_APP_CREDENTIAL_ID)
    const credential = JSON.parse(raw) as GitHubAppCredential
    return credential.version === GITHUB_APP_CREDENTIAL_VERSION && credential.accessToken
      ? {
          ...credential,
          identityVersion: credential.identityVersion || `legacy-${credential.updatedAt}`,
        }
      : null
  }
  catch (error) {
    if (error instanceof AppError && (error.code === 'secret_not_found' || error.code === 'secret_not_configured')) {
      return null
    }
    throw error
  }
}

function writeCredential(credential: GitHubAppCredential): void {
  Secrets.upsertSecret({
    id: GITHUB_APP_CREDENTIAL_ID,
    kind: GITHUB_APP_CREDENTIAL_KIND,
    label: 'GitHub App user',
    secret: JSON.stringify(credential),
  })
  invalidateGitHubIdentity()
}

function completeLogin(loginId: string, result: Pick<GitHubDeviceLoginStatus, 'state' | 'error'>): void {
  const pending = pendingLogins.get(loginId)
  if (!pending) {
    return
  }
  pendingLogins.delete(loginId)
  clearTimeout(pending.timeout)
  pending.abortController.abort()
  const status: GitHubDeviceLoginStatus = {
    ...pending.status,
    state: result.state,
    completedAt: now(),
    error: result.error,
  }
  finishedLogins.set(loginId, status)
}

function clearPendingLogins(): void {
  for (const pending of pendingLogins.values()) {
    clearTimeout(pending.timeout)
    pending.abortController.abort()
  }
  pendingLogins.clear()
  finishedLogins.clear()
}

function baseConnection(config: ReturnType<typeof loadGitHubAppConfig>, state: 'disconnected'): GitHubAppConnectionView {
  return {
    state,
    appName: config.name,
    appSlug: config.slug,
    installationUrl: config.slug ? installationUrl(config.slug) : null,
    viewer: null,
    expiresAt: null,
    refreshTokenExpiresAt: null,
    error: null,
  }
}

function requireConfig(): { clientId: string, slug: string, name: string } {
  const config = loadGitHubAppConfig()
  if (!config.clientId || !config.slug) {
    throw new AppError({
      code: 'github_app_unconfigured',
      status: 503,
      message: 'GitHub App is not configured in this build.',
    })
  }
  return config as { clientId: string, slug: string, name: string }
}

function installationUrl(slug: string): string {
  return `https://github.com/apps/${slug}/installations/new`
}

function needsRefresh(credential: GitHubAppCredential): boolean {
  return credential.expiresAt !== null && credential.expiresAt <= now() + REFRESH_WINDOW_SECONDS
}

function isExpired(timestamp: number | null): boolean {
  return timestamp !== null && timestamp <= now()
}

function expiredConnectionError(): AppError {
  return new AppError({
    code: 'github_app_connection_expired',
    status: 401,
    message: 'Your GitHub App connection has expired. Connect GitHub App again to continue.',
  })
}

function invalidateGitHubIdentity(): void {
  resetGitHubClientState()
  clearGitHubReadInFlight()
}

function fetchImpl(): FetchLike {
  return fetchForTests ?? outboundFetch
}

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, milliseconds)
    signal.addEventListener('abort', () => {
      clearTimeout(timeout)
      reject(new Error('GitHub device authorization was cancelled.'))
    }, { once: true })
  })
}
