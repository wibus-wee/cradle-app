import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { agentCredentials } from '@cradle/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AppError } from '../../errors/app-error'
import { db, initializeDatabase, shutdownInfra } from '../../infra'
import { resetGitHubAuthProviderForTests, setGitHubAuthProvider } from '../../lib/github/auth-provider'
import { hasGitHubToken, resetGitHubTokenCache, resolveGitHubToken } from '../../lib/github-api-token'
import { resetCredentialKeyringForTests } from '../secrets/service'
import {
  cancelGitHubDeviceLogin,
  disconnectGitHubApp,
  getGitHubAppConnection,
  getGitHubDeviceLogin,
  resolveGitHubAppIdentity,
  setGitHubAuthFetchForTests,
  startGitHubDeviceLogin,
} from './service'

const previousDataDir = process.env.CRADLE_DATA_DIR
const previousCredentialSecret = process.env.CRADLE_CREDENTIAL_SECRET
const previousGitHubToken = process.env.GH_TOKEN
let dataDir = ''

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'cradle-github-auth-'))
  process.env.CRADLE_DATA_DIR = dataDir
  process.env.CRADLE_CREDENTIAL_SECRET = 'github-auth-test-secret'
  initializeDatabase()
  setGitHubAuthProvider(resolveGitHubAppIdentity)
})

afterEach(() => {
  setGitHubAuthFetchForTests(null)
  resetGitHubAuthProviderForTests()
  resetGitHubTokenCache()
  vi.useRealTimers()
  shutdownInfra()
  resetCredentialKeyringForTests()
  rmSync(dataDir, { recursive: true, force: true })
  if (previousDataDir === undefined) { delete process.env.CRADLE_DATA_DIR }
  else { process.env.CRADLE_DATA_DIR = previousDataDir }
  if (previousCredentialSecret === undefined) { delete process.env.CRADLE_CREDENTIAL_SECRET }
  else { process.env.CRADLE_CREDENTIAL_SECRET = previousCredentialSecret }
  if (previousGitHubToken === undefined) { delete process.env.GH_TOKEN }
  else { process.env.GH_TOKEN = previousGitHubToken }
})

function jsonResponse(body: object): Response {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
}

describe('gitHub App Device Flow', () => {
  it('starts one pending authorization and cancels it without exposing the device code', async () => {
    setGitHubAuthFetchForTests(async (input) => {
      if (`${input}`.includes('/device/code')) {
        return jsonResponse({ device_code: 'device-secret', user_code: 'ABCD-EFGH', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 60 })
      }
      return jsonResponse({ error: 'authorization_pending' })
    })

    const start = await startGitHubDeviceLogin()
    expect(start).toMatchObject({ userCode: 'ABCD-EFGH', pollInterval: 60 })
    expect(JSON.stringify(start)).not.toContain('device-secret')
    expect(JSON.stringify(await getGitHubAppConnection())).not.toContain('device-secret')
    expect(getGitHubDeviceLogin(start.loginId).state).toBe('pending')
    await expect(startGitHubDeviceLogin()).rejects.toMatchObject({ code: 'github_device_login_active', status: 409 } satisfies Partial<AppError>)

    expect(cancelGitHubDeviceLogin(start.loginId)).toEqual({ ok: true })
    expect(getGitHubDeviceLogin(start.loginId).state).toBe('cancelled')
  })

  it('persists an encrypted connection, rotates it before expiry, and redacts status', async () => {
    const responses = [
      { device_code: 'device-secret', user_code: 'ABCD-EFGH', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 1 },
      { access_token: 'access-token-one', refresh_token: 'refresh-token-one', expires_in: 1, refresh_token_expires_in: 3600 },
      { login: 'octocat', avatar_url: 'https://avatars.githubusercontent.com/u/1', html_url: 'https://github.com/octocat' },
      { access_token: 'access-token-two', refresh_token: 'refresh-token-two', expires_in: 3600, refresh_token_expires_in: 7200 },
      { login: 'octocat', avatar_url: 'https://avatars.githubusercontent.com/u/1', html_url: 'https://github.com/octocat' },
    ]
    setGitHubAuthFetchForTests(async () => jsonResponse(responses.shift() ?? {}))

    const start = await startGitHubDeviceLogin()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(getGitHubDeviceLogin(start.loginId).state).toBe('completed')

    const connection = await getGitHubAppConnection()
    expect(connection).toMatchObject({ state: 'connected', viewer: { login: 'octocat' } })
    expect(JSON.stringify(connection)).not.toContain('token')
    const stored = db().select().from(agentCredentials).get()
    expect(stored?.encryptedSecret).not.toContain('access-token-one')
    expect(stored?.encryptedSecret).not.toContain('refresh-token-one')

    const identity = await resolveGitHubAppIdentity()
    expect(identity?.accessToken).toBe('access-token-two')
    expect(identity?.cacheKey).not.toContain('access-token-two')
    process.env.GH_TOKEN = 'legacy-token'
    expect(await resolveGitHubToken()).toBe('access-token-two')
    expect(await hasGitHubToken()).toBe(true)
    expect(disconnectGitHubApp()).toEqual({ ok: true })
    expect((await getGitHubAppConnection()).state).toBe('disconnected')
  })

  it('fails closed when refresh is rejected', async () => {
    const responses = [
      { device_code: 'device-secret', user_code: 'ABCD-EFGH', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 1 },
      { access_token: 'access-token-one', refresh_token: 'refresh-token-one', expires_in: 1, refresh_token_expires_in: 3600 },
      { login: 'octocat' },
      { error: 'bad_refresh_token', error_description: 'Refresh token revoked' },
    ]
    setGitHubAuthFetchForTests(async () => jsonResponse(responses.shift() ?? {}))

    await startGitHubDeviceLogin()
    await new Promise(resolve => setTimeout(resolve, 0))
    process.env.GH_TOKEN = 'legacy-token'
    await expect(resolveGitHubAppIdentity()).rejects.toMatchObject({ code: 'github_app_connection_expired', status: 401 } satisfies Partial<AppError>)
    await expect(resolveGitHubToken()).rejects.toMatchObject({ code: 'github_app_connection_expired', status: 401 } satisfies Partial<AppError>)
  })

  it('waits through pending and slow-down responses before completing', async () => {
    vi.useFakeTimers()
    const tokenRequests: string[] = []
    const responses = [
      { device_code: 'device-secret', user_code: 'ABCD-EFGH', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 1 },
      { error: 'authorization_pending' },
      { error: 'slow_down' },
      { access_token: 'access-token', refresh_token: 'refresh-token', expires_in: 3600, refresh_token_expires_in: 7200 },
      { login: 'octocat' },
    ]
    setGitHubAuthFetchForTests(async (input, init) => {
      if (`${input}`.includes('/access_token')) {
        tokenRequests.push(String(init?.body))
      }
      return jsonResponse(responses.shift() ?? {})
    })

    const start = await startGitHubDeviceLogin()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(getGitHubDeviceLogin(start.loginId).state).toBe('pending')
    await vi.advanceTimersByTimeAsync(6_000)

    expect(getGitHubDeviceLogin(start.loginId)).toMatchObject({ state: 'completed', error: null })
    expect(tokenRequests).toHaveLength(3)
    expect(tokenRequests.every(body => body.includes('client_id=Iv23liafSutKq8Ldqkog'))).toBe(true)
  })

  it('expires an incomplete device authorization', async () => {
    vi.useFakeTimers()
    setGitHubAuthFetchForTests(async (input) => {
      if (`${input}`.includes('/device/code')) {
        return jsonResponse({ device_code: 'device-secret', user_code: 'ABCD-EFGH', verification_uri: 'https://github.com/login/device', expires_in: 1, interval: 60 })
      }
      return jsonResponse({ error: 'authorization_pending' })
    })

    const start = await startGitHubDeviceLogin()
    await vi.advanceTimersByTimeAsync(1_000)

    expect(getGitHubDeviceLogin(start.loginId)).toMatchObject({
      state: 'failed',
      error: 'GitHub device authorization expired.',
    })
  })
})
