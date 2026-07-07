/**
 * Owns Cradle-side ChatGPT OAuth material for Codex app-server external auth.
 */
import { readOptionalObjectRecord as readRecord } from '../../../../helpers/json-record'
import { outboundFetch } from '../../../../lib/outbound-network'
import type { CodexAuthMode, CodexConfig } from '../../../provider-contracts/provider-base'
import type { SecretValueWithMetadata } from '../../../secrets/service'
import type { LoginAccountParams } from '../app-server-protocol/v2/LoginAccountParams'

export const CODEX_CHATGPT_AUTH_SECRET_KIND = 'chatgpt-auth'
export const CODEX_PERSONAL_ACCESS_TOKEN_SECRET_KIND = 'codex-personal-access-token'
export const CODEX_BEDROCK_API_KEY_SECRET_KIND = 'codex-bedrock-api-key'

export const CODEX_PERSONAL_ACCESS_TOKEN_ENV = 'CODEX_ACCESS_TOKEN'
export const CODEX_BEDROCK_API_KEY_ENV = 'AWS_BEARER_TOKEN_BEDROCK'
export const CODEX_BEDROCK_REGION_ENV = 'AWS_REGION'

const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const OPENAI_OAUTH_TOKEN_URL = 'https://auth.openai.com/oauth/token'
const ACCESS_TOKEN_REFRESH_SKEW_SECONDS = 5 * 60

export class CodexChatgptAuthReauthRequiredError extends Error {
  readonly code = 'codex_chatgpt_auth_reauth_required'

  constructor(message = 'Codex ChatGPT auth expired. Please sign in again.') {
    super(message)
    this.name = 'CodexChatgptAuthReauthRequiredError'
  }
}

export interface CodexChatgptAuthCredential {
  credentialRef: string
  accessToken: string | null
  refreshToken: string | null
  chatgptAccountId: string
  chatgptPlanType: string | null
}

export interface CodexChatgptAuthDeps {
  updateSecretValue?: (credentialRef: string, secret: string) => void
}

export type CodexAppServerAuthResolution
  = | { kind: 'apiKey', apiKey: string }
    | { kind: 'chatgptAuthTokens', chatgptAuth: CodexChatgptAuthCredential }
    | { kind: 'personalAccessToken', personalAccessToken: string }
    | { kind: 'bedrockApiKey', bedrockApiKey: string, region: string }
    | { kind: 'none' }

export interface CodexAppServerAuthCarrier {
  credentialRef?: string | null
  secretRef?: string | null
}

export interface CodexAppServerAuthResolverDeps {
  readSecretValueWithMetadata?: (credentialRef: string) => SecretValueWithMetadata
  readSecret: (credentialRef: string) => string
}

interface OAuthTokenResponse {
  access_token?: unknown
  refresh_token?: unknown
  id_token?: unknown
}

interface ParsedJwtClaims {
  'email'?: string
  'exp'?: number
  'chatgpt_account_id'?: string
  'chatgpt_plan_type'?: string
  'https://api.openai.com/auth'?: {
    chatgpt_account_id?: string
    chatgpt_plan_type?: string
  }
}

export function readCodexChatgptAuthCredential(
  credentialRef: string | null,
  rawSecret: string | null,
): CodexChatgptAuthCredential | null {
  if (!credentialRef || !rawSecret?.trim()) {
    return null
  }

  const parsed = parseJsonRecord(rawSecret)
  if (!parsed) {
    return null
  }

  const tokens = readRecord(parsed.tokens)
  const idToken = readRecord(tokens?.id_token)
  const accessToken = readString(parsed.accessToken)
    ?? readString(parsed.access_token)
    ?? readString(tokens?.access_token)
  const refreshToken = readString(parsed.refreshToken)
    ?? readString(parsed.refresh_token)
    ?? readString(tokens?.refresh_token)
  const claims = parseJwtClaims(accessToken) ?? parseJwtClaims(readString(idToken?.raw_jwt))
  const authClaims = readRecord(claims?.['https://api.openai.com/auth'])

  const chatgptAccountId = readString(parsed.chatgptAccountId)
    ?? readString(parsed.chatgpt_account_id)
    ?? readString(parsed.accountId)
    ?? readString(parsed.account_id)
    ?? readString(tokens?.account_id)
    ?? readString(idToken?.chatgpt_account_id)
    ?? readString(authClaims?.chatgpt_account_id)
    ?? readString(claims?.chatgpt_account_id)
  if (!chatgptAccountId) {
    return null
  }

  const chatgptPlanType = normalizePlanType(
    readString(parsed.chatgptPlanType)
    ?? readString(parsed.chatgpt_plan_type)
    ?? readString(parsed.planType)
    ?? readString(parsed.plan_type)
    ?? readPlanType(idToken?.chatgpt_plan_type)
    ?? readString(authClaims?.chatgpt_plan_type)
    ?? readString(claims?.chatgpt_plan_type),
  )

  return {
    credentialRef,
    accessToken,
    refreshToken,
    chatgptAccountId,
    chatgptPlanType,
  }
}

export function resolveCodexAppServerAuth(
  rawInput: CodexAppServerAuthCarrier,
  config: Pick<CodexConfig, 'apiKey' | 'authMode' | 'bedrock'>,
  envVar: string,
  deps: CodexAppServerAuthResolverDeps,
): CodexAppServerAuthResolution {
  const credentialRef = rawInput.secretRef ?? rawInput.credentialRef ?? null
  if (credentialRef) {
    if (!deps.readSecretValueWithMetadata) {
      throw new Error('Codex auth resolution requires secret metadata reader')
    }
    const credential = deps.readSecretValueWithMetadata(credentialRef)
    const auth = resolveCodexAppServerCredentialAuth(credential, config)
    assertSelectedCodexAuthMode(config.authMode, auth, credential.kind)
    return auth
  }
  if (config.apiKey) {
    assertNoNativeCodexAuthModeWithoutCredential(config.authMode)
    return { kind: 'apiKey', apiKey: config.apiKey }
  }
  assertNoNativeCodexAuthModeWithoutCredential(config.authMode)
  const envApiKey = process.env[envVar]
  if (envApiKey) {
    return { kind: 'apiKey', apiKey: envApiKey }
  }
  return { kind: 'none' }
}

export function readCodexApiKeyAuth(auth: CodexAppServerAuthResolution): string | null {
  return auth.kind === 'apiKey' ? auth.apiKey : null
}

export function readCodexChatgptAuth(auth: CodexAppServerAuthResolution): CodexChatgptAuthCredential | null {
  return auth.kind === 'chatgptAuthTokens' ? auth.chatgptAuth : null
}

function resolveCodexAppServerCredentialAuth(
  credential: SecretValueWithMetadata,
  config: Pick<CodexConfig, 'bedrock'>,
): CodexAppServerAuthResolution {
  switch (credential.kind) {
    case CODEX_CHATGPT_AUTH_SECRET_KIND: {
      const chatgptAuth = readCodexChatgptAuthCredential(credential.id, credential.secret)
      if (!chatgptAuth) {
        throw new Error('Codex ChatGPT credential metadata is invalid')
      }
      return { kind: 'chatgptAuthTokens', chatgptAuth }
    }
    case CODEX_PERSONAL_ACCESS_TOKEN_SECRET_KIND:
      return { kind: 'personalAccessToken', personalAccessToken: credential.secret }
    case CODEX_BEDROCK_API_KEY_SECRET_KIND: {
      const region = config.bedrock?.region
      if (!region) {
        throw new Error('Codex Bedrock auth requires bedrock.region in provider config')
      }
      return { kind: 'bedrockApiKey', bedrockApiKey: credential.secret, region }
    }
    default:
      return { kind: 'apiKey', apiKey: credential.secret }
  }
}

function assertSelectedCodexAuthMode(
  selected: CodexAuthMode | undefined,
  auth: CodexAppServerAuthResolution,
  credentialKind: string,
): void {
  if (!selected) {
    return
  }
  if (selected === 'personalAccessToken' && auth.kind !== 'personalAccessToken') {
    throw new Error(`Codex personal access token auth requires a ${CODEX_PERSONAL_ACCESS_TOKEN_SECRET_KIND} credential, got ${credentialKind}`)
  }
  if (selected === 'bedrockApiKey' && auth.kind !== 'bedrockApiKey') {
    throw new Error(`Codex Bedrock API key auth requires a ${CODEX_BEDROCK_API_KEY_SECRET_KIND} credential, got ${credentialKind}`)
  }
}

function assertNoNativeCodexAuthModeWithoutCredential(selected: CodexAuthMode | undefined): void {
  if (selected === 'personalAccessToken') {
    throw new Error(`Codex personal access token auth requires a ${CODEX_PERSONAL_ACCESS_TOKEN_SECRET_KIND} credential`)
  }
  if (selected === 'bedrockApiKey') {
    throw new Error(`Codex Bedrock API key auth requires a ${CODEX_BEDROCK_API_KEY_SECRET_KIND} credential`)
  }
}

export async function ensureCodexChatgptAuthAccessToken(
  credential: CodexChatgptAuthCredential,
  deps: CodexChatgptAuthDeps,
): Promise<CodexChatgptAuthCredential> {
  if (credential.accessToken && !isAccessTokenExpiring(credential.accessToken)) {
    return credential
  }
  return refreshCodexChatgptAuthCredential(credential, deps)
}

export function buildCodexChatgptAuthLoginParams(
  credential: CodexChatgptAuthCredential,
): LoginAccountParams {
  if (!credential.accessToken) {
    throw new Error('Codex ChatGPT auth requires an access token')
  }
  return {
    type: 'chatgptAuthTokens',
    accessToken: credential.accessToken,
    chatgptAccountId: credential.chatgptAccountId,
    chatgptPlanType: credential.chatgptPlanType,
  }
}

export async function refreshCodexChatgptAuthCredential(
  credential: CodexChatgptAuthCredential,
  deps: CodexChatgptAuthDeps,
): Promise<CodexChatgptAuthCredential> {
  if (!credential.refreshToken) {
    throw new Error('Codex ChatGPT auth refresh requires a refresh token')
  }

  const response = await outboundFetch(OPENAI_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'cradle-codex-chatgpt-auth',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: credential.refreshToken,
      client_id: CODEX_CLIENT_ID,
      scope: 'openid profile email',
    }),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    if (isReauthRequiredRefreshResponse(response.status, text)) {
      throw new CodexChatgptAuthReauthRequiredError()
    }
    throw new Error(`Codex ChatGPT auth refresh failed: ${response.status} ${text}`.trim())
  }

  const body = await response.json() as OAuthTokenResponse
  const accessToken = readString(body.access_token)
  if (!accessToken) {
    throw new Error('Codex ChatGPT auth refresh response is missing access_token')
  }

  const nextRefreshToken = readString(body.refresh_token) ?? credential.refreshToken
  const claims = parseJwtClaims(accessToken) ?? parseJwtClaims(readString(body.id_token))
  const authClaims = readRecord(claims?.['https://api.openai.com/auth'])
  const chatgptAccountId = readString(authClaims?.chatgpt_account_id)
    ?? readString(claims?.chatgpt_account_id)
    ?? credential.chatgptAccountId
  const chatgptPlanType = normalizePlanType(
    readString(authClaims?.chatgpt_plan_type)
    ?? readString(claims?.chatgpt_plan_type)
    ?? credential.chatgptPlanType,
  )

  const next: CodexChatgptAuthCredential = {
    credentialRef: credential.credentialRef,
    accessToken,
    refreshToken: nextRefreshToken,
    chatgptAccountId,
    chatgptPlanType,
  }
  deps.updateSecretValue?.(credential.credentialRef, JSON.stringify({
    kind: CODEX_CHATGPT_AUTH_SECRET_KIND,
    accessToken,
    refreshToken: nextRefreshToken,
    chatgptAccountId,
    chatgptPlanType,
    updatedAt: Date.now(),
  }))
  return next
}

function parseJsonRecord(raw: string): Record<string, unknown> | null {
  try {
    return readRecord(JSON.parse(raw))
  }
  catch {
    return null
  }
}

function isReauthRequiredRefreshResponse(status: number, body: string): boolean {
  if (status !== 400 && status !== 401) {
    return false
  }
  const parsed = parseJsonRecord(body)
  const error = readRecord(parsed?.error)
  return readString(error?.code) === 'refresh_token_invalidated'
    || readString(error?.code) === 'token_expired'
    || readString(error?.message)?.toLowerCase().includes('refresh token has been invalidated') === true
    || readString(error?.message)?.toLowerCase().includes('try signing in again') === true
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function readPlanType(value: unknown): string | null {
  if (typeof value === 'string') {
    return value
  }
  const record = readRecord(value)
  return readString(record?.known) ?? readString(record?.unknown)
}

function normalizePlanType(value: string | null): string | null {
  return value?.trim().toLowerCase() || null
}

function isAccessTokenExpiring(token: string): boolean {
  const exp = parseJwtClaims(token)?.exp
  if (typeof exp !== 'number' || !Number.isFinite(exp)) {
    return false
  }
  const nowSeconds = Math.floor(Date.now() / 1000)
  return exp <= nowSeconds + ACCESS_TOKEN_REFRESH_SKEW_SECONDS
}

function parseJwtClaims(token: string | null): ParsedJwtClaims | null {
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
    return JSON.parse(Buffer.from(padded, 'base64url').toString('utf8')) as ParsedJwtClaims
  }
  catch {
    return null
  }
}
