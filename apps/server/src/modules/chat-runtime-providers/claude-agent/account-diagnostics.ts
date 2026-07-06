import { execFile } from 'node:child_process'

import type { AccountInfo, Options, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { query } from '@anthropic-ai/claude-agent-sdk'

import { resolveAnthropicWireAuth } from '../../provider-catalog/provider-endpoint-registry'
import { readTrustedClaudeAgentConfig, resolveApiKey } from '../../provider-contracts/provider-base'
import * as ProviderTargets from '../../provider-targets/service'
import * as Secrets from '../../secrets/service'
import { removeCradleOwnedClaudeConfigDirFromEnv } from './runtime-context'

export type ClaudeAgentAuthDiagnosticsStatus = 'ready' | 'warning' | 'error' | 'unknown'
export type ClaudeAgentAuthStatus = 'authenticated' | 'unauthenticated' | 'unknown'

export interface ClaudeAgentAuthDiagnostics {
  providerTargetId: string
  supported: boolean
  unavailableReason: string | null
  refreshedAt: number | null
  status: ClaudeAgentAuthDiagnosticsStatus
  available: boolean
  authStatus: ClaudeAgentAuthStatus
  authMode: 'apiKey' | 'claudeAi' | null
  authType: string | null
  authLabel: string | null
  version: string | null
  message: string | null
  account: {
    email: string | null
    organization: string | null
    subscriptionType: string | null
    tokenSource: string | null
    apiKeySource: string | null
    apiProvider: string | null
  } | null
}

interface CommandResult {
  code: number
  stdout: string
  stderr: string
}

export interface ClaudeAgentAccountProbeQuery {
  initializationResult?: () => Promise<{ account?: AccountInfo }>
  close?: () => void
}

export type ClaudeAgentAccountProbeQueryFactory = (input: Parameters<typeof query>[0]) => ClaudeAgentAccountProbeQuery

interface ClaudeAgentAuthDiagnosticsDeps {
  resolveProviderTarget: typeof ProviderTargets.resolveProviderTarget
  readSecret: typeof Secrets.readSecret
  runCommand: (command: string, args: string[], env: NodeJS.ProcessEnv) => Promise<CommandResult>
  query: ClaudeAgentAccountProbeQueryFactory
}

const DEFAULT_COMMAND_TIMEOUT_MS = 8_000
const DEFAULT_CLAUDE_AUTH_DIAGNOSTICS_DEPS: ClaudeAgentAuthDiagnosticsDeps = {
  resolveProviderTarget: ProviderTargets.resolveProviderTarget,
  readSecret: Secrets.readSecret,
  runCommand: runCommandWithExecFile,
  query,
}

export async function readClaudeAgentAuthDiagnostics(
  input: { providerTargetId: string },
  deps: ClaudeAgentAuthDiagnosticsDeps = DEFAULT_CLAUDE_AUTH_DIAGNOSTICS_DEPS,
): Promise<ClaudeAgentAuthDiagnostics> {
  const target = deps.resolveProviderTarget(input.providerTargetId)
  if (target.providerKind !== 'anthropic') {
    return unsupportedClaudeAgentDiagnostics(
      target.id,
      'Claude Agent auth diagnostics are only available for Anthropic provider targets.',
    )
  }

  const config = readTrustedClaudeAgentConfig(target.configJson)
  if (config.authMode === 'apiKey') {
    return readClaudeCredentialAuthDiagnostics(
      { providerTargetId: target.id, credentialRef: target.credentialRef },
      config,
      deps,
    )
  }

  return await readClaudeAiAuthDiagnostics({ providerTargetId: target.id }, deps)
}

function readClaudeCredentialAuthDiagnostics(
  target: { providerTargetId: string, credentialRef: string | null },
  config: ReturnType<typeof readTrustedClaudeAgentConfig>,
  deps: ClaudeAgentAuthDiagnosticsDeps,
): ClaudeAgentAuthDiagnostics {
  const refreshedAt = Date.now()
  const envVar = resolveAnthropicWireAuth(config.baseUrl ?? null) === 'bearer-token'
    ? 'ANTHROPIC_AUTH_TOKEN'
    : 'ANTHROPIC_API_KEY'
  const authType = 'apiKey'
  const authLabel = 'Claude API Key'
  const description = 'Claude API key'
  const missingCredentialMessage = 'Claude API key authentication is selected, but no API key is configured.'
  let apiKey: string | null
  try {
    apiKey = resolveApiKey(
      { credentialRef: target.credentialRef },
      config.apiKey,
      envVar,
      deps,
    )
  }
  catch (error) {
    return {
      providerTargetId: target.providerTargetId,
      supported: true,
      unavailableReason: null,
      refreshedAt,
      status: 'error',
      available: false,
      authStatus: 'unknown',
      authMode: 'apiKey',
      authType,
      authLabel,
      version: null,
      message: `${description} credential could not be read: ${errorMessage(error instanceof Error ? error : new Error(String(error)))}.`,
      account: null,
    }
  }
  const hasApiKey = Boolean(apiKey?.trim())

  return {
    providerTargetId: target.providerTargetId,
    supported: true,
    unavailableReason: null,
    refreshedAt,
    status: hasApiKey ? 'ready' : 'error',
    available: hasApiKey,
    authStatus: hasApiKey ? 'authenticated' : 'unauthenticated',
    authMode: 'apiKey',
    authType,
    authLabel,
    version: null,
    message: hasApiKey ? null : missingCredentialMessage,
    account: null,
  }
}

async function readClaudeAiAuthDiagnostics(
  target: { providerTargetId: string },
  deps: ClaudeAgentAuthDiagnosticsDeps,
): Promise<ClaudeAgentAuthDiagnostics> {
  const refreshedAt = Date.now()
  const env = buildClaudeOfficialDiagnosticsEnv()

  const version = await runClaudeDiagnosticsCommand(['--version'], env, deps)
  if (version.outcome === 'failed') {
    return {
      ...baseClaudeAiDiagnostics(target.providerTargetId, refreshedAt),
      status: 'error',
      available: false,
      message: isMissingCommandError(version.error)
        ? 'Claude Agent CLI (`claude`) is not installed or not on PATH.'
        : `Failed to execute Claude Agent CLI health check: ${errorMessage(version.error)}.`,
    }
  }

  const versionOutput = version.result
  if (versionOutput.code !== 0) {
    const detail = detailFromResult(versionOutput)
    return {
      ...baseClaudeAiDiagnostics(target.providerTargetId, refreshedAt),
      status: 'error',
      available: false,
      message: detail
        ? `Claude Agent CLI is installed but failed to run. ${detail}`
        : 'Claude Agent CLI is installed but failed to run.',
    }
  }

  const parsedVersion = parseGenericCliVersion(`${versionOutput.stdout}\n${versionOutput.stderr}`)
  const auth = await runClaudeDiagnosticsCommand(['auth', 'status'], env, deps)
  if (auth.outcome === 'failed') {
    return {
      ...baseClaudeAiDiagnostics(target.providerTargetId, refreshedAt),
      status: 'warning',
      available: true,
      version: parsedVersion,
      message: `Could not verify Claude authentication status: ${errorMessage(auth.error)}.`,
    }
  }

  const parsed = parseClaudeAuthStatusFromOutput(auth.result)
  const authMethod = extractAuthMethodFromOutput(auth.result)
  let subscriptionType = extractSubscriptionTypeFromOutput(auth.result)
  let account: NonNullable<ClaudeAgentAuthDiagnostics['account']> | null = null
  if (!subscriptionType && parsed.authStatus === 'authenticated') {
    const probedAccount = await probeClaudeAccount(deps, env)
    subscriptionType = probedAccount?.subscriptionType ?? null
    account = projectClaudeAccount(probedAccount)
  }

  const authMetadata = claudeAuthMetadata({ subscriptionType, authMethod })

  return {
    ...baseClaudeAiDiagnostics(target.providerTargetId, refreshedAt),
    status: parsed.status,
    available: true,
    authStatus: parsed.authStatus,
    authType: authMetadata?.type ?? null,
    authLabel: authMetadata?.label ?? null,
    version: parsedVersion,
    message: parsed.message ?? null,
    account,
  }
}

function unsupportedClaudeAgentDiagnostics(
  providerTargetId: string,
  unavailableReason: string,
): ClaudeAgentAuthDiagnostics {
  return {
    providerTargetId,
    supported: false,
    unavailableReason,
    refreshedAt: null,
    status: 'unknown',
    available: false,
    authStatus: 'unknown',
    authMode: null,
    authType: null,
    authLabel: null,
    version: null,
    message: null,
    account: null,
  }
}

function baseClaudeAiDiagnostics(providerTargetId: string, refreshedAt: number): ClaudeAgentAuthDiagnostics {
  return {
    providerTargetId,
    supported: true,
    unavailableReason: null,
    refreshedAt,
    status: 'unknown',
    available: false,
    authStatus: 'unknown',
    authMode: 'claudeAi',
    authType: null,
    authLabel: null,
    version: null,
    message: null,
    account: null,
  }
}

function buildClaudeOfficialDiagnosticsEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_AUTH_TOKEN
  delete env.ANTHROPIC_BASE_URL
  removeCradleOwnedClaudeConfigDirFromEnv(env)
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
  env.CLAUDE_CODE_ATTRIBUTION_HEADER = '0'
  return env
}

async function runClaudeDiagnosticsCommand(
  args: string[],
  env: NodeJS.ProcessEnv,
  deps: ClaudeAgentAuthDiagnosticsDeps,
): Promise<
  | { outcome: 'completed', result: CommandResult }
  | { outcome: 'failed', error: Error }
> {
  try {
    return { outcome: 'completed', result: await deps.runCommand('claude', args, env) }
  }
  catch (error) {
    return { outcome: 'failed', error: error instanceof Error ? error : new Error(String(error)) }
  }
}

function runCommandWithExecFile(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      env,
      timeout: DEFAULT_COMMAND_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (!error) {
        resolve({ code: 0, stdout, stderr })
        return
      }
      const code = typeof error.code === 'number' ? error.code : null
      if (code !== null) {
        resolve({ code, stdout, stderr })
        return
      }
      reject(error)
    })
  })
}

function parseClaudeAuthStatusFromOutput(result: CommandResult): {
  status: ClaudeAgentAuthDiagnosticsStatus
  authStatus: ClaudeAgentAuthStatus
  message?: string
} {
  const lowerOutput = `${result.stdout}\n${result.stderr}`.toLowerCase()

  if (
    lowerOutput.includes('unknown command')
    || lowerOutput.includes('unrecognized command')
    || lowerOutput.includes('unexpected argument')
  ) {
    return {
      status: 'warning',
      authStatus: 'unknown',
      message: 'Claude Agent authentication status command is unavailable in this version of Claude.',
    }
  }

  if (
    lowerOutput.includes('not logged in')
    || lowerOutput.includes('login required')
    || lowerOutput.includes('authentication required')
    || lowerOutput.includes('run `claude login`')
    || lowerOutput.includes('run claude login')
  ) {
    return {
      status: 'error',
      authStatus: 'unauthenticated',
      message: 'Claude is not authenticated. Run `claude auth login` and try again.',
    }
  }

  const parsedAuth = parseAuthBooleanFromJson(result.stdout.trim())
  if (parsedAuth.auth === true) {
    return { status: 'ready', authStatus: 'authenticated' }
  }
  if (parsedAuth.auth === false) {
    return {
      status: 'error',
      authStatus: 'unauthenticated',
      message: 'Claude is not authenticated. Run `claude auth login` and try again.',
    }
  }
  if (parsedAuth.attemptedJsonParse) {
    return {
      status: 'warning',
      authStatus: 'unknown',
      message: 'Could not verify Claude authentication status from JSON output (missing auth marker).',
    }
  }
  if (result.code === 0) {
    return { status: 'ready', authStatus: 'authenticated' }
  }

  const detail = detailFromResult(result)
  return {
    status: 'warning',
    authStatus: 'unknown',
    message: detail
      ? `Could not verify Claude authentication status. ${detail}`
      : 'Could not verify Claude authentication status.',
  }
}

function parseAuthBooleanFromJson(text: string): {
  attemptedJsonParse: boolean
  auth: boolean | undefined
} {
  if (!text || (!text.startsWith('{') && !text.startsWith('['))) {
    return { attemptedJsonParse: false, auth: undefined }
  }
  try {
    return {
      attemptedJsonParse: true,
      auth: extractAuthBoolean(JSON.parse(text)),
    }
  }
  catch {
    return { attemptedJsonParse: false, auth: undefined }
  }
}

function extractAuthBoolean(value: unknown): boolean | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const nested = extractAuthBoolean(entry)
      if (nested !== undefined) {
        return nested
      }
    }
    return undefined
  }
  if (!isRecord(value)) {
    return undefined
  }
  for (const key of ['authenticated', 'isAuthenticated', 'loggedIn', 'isLoggedIn'] as const) {
    if (typeof value[key] === 'boolean') {
      return value[key]
    }
  }
  for (const key of ['auth', 'status', 'session', 'account'] as const) {
    const nested = extractAuthBoolean(value[key])
    if (nested !== undefined) {
      return nested
    }
  }
  return undefined
}

function extractSubscriptionTypeFromOutput(result: CommandResult): string | null {
  return extractFromJson(result.stdout.trim(), findSubscriptionType)
}

function extractAuthMethodFromOutput(result: CommandResult): string | null {
  return extractFromJson(result.stdout.trim(), findAuthMethod)
}

function extractFromJson(text: string, read: (value: unknown) => string | null): string | null {
  if (!text || (!text.startsWith('{') && !text.startsWith('['))) {
    return null
  }
  try {
    return read(JSON.parse(text))
  }
  catch {
    return null
  }
}

function findSubscriptionType(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const nested = findSubscriptionType(entry)
      if (nested) {
        return nested
      }
    }
    return null
  }
  if (!isRecord(value)) {
    return null
  }
  for (const key of ['subscriptionType', 'subscription_type', 'plan', 'tier', 'planType', 'plan_type'] as const) {
    const direct = nonEmptyString(value[key])
    if (direct) {
      return direct
    }
  }
  for (const key of ['account', 'subscription', 'user', 'billing'] as const) {
    const nested = findSubscriptionType(value[key])
    if (nested) {
      return nested
    }
  }
  return null
}

function findAuthMethod(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const nested = findAuthMethod(entry)
      if (nested) {
        return nested
      }
    }
    return null
  }
  if (!isRecord(value)) {
    return null
  }
  for (const key of ['authMethod', 'auth_method', 'auth_type', 'authType'] as const) {
    const direct = nonEmptyString(value[key])
    if (direct) {
      return direct
    }
  }
  for (const key of ['auth', 'account', 'session'] as const) {
    const nested = findAuthMethod(value[key])
    if (nested) {
      return nested
    }
  }
  return null
}

async function probeClaudeAccount(
  deps: ClaudeAgentAuthDiagnosticsDeps,
  env: NodeJS.ProcessEnv,
): Promise<AccountInfo | null> {
  const abortController = new AbortController()
  let timeout: NodeJS.Timeout | null = null
  const timeoutResult = new Promise<null>((resolve) => {
    timeout = setTimeout(() => {
      abortController.abort()
      resolve(null)
    }, DEFAULT_COMMAND_TIMEOUT_MS)
  })
  const options: Options = {
    persistSession: false,
    abortController,
    settingSources: ['user', 'project', 'local'],
    allowedTools: [],
    stderr: () => {},
    env,
  }
  try {
    const activeQuery = deps.query({
      prompt: emptyClaudeAgentProbeInput(abortController.signal),
      options,
    })
    try {
      const initializationResult = activeQuery.initializationResult
      if (typeof initializationResult !== 'function') {
        return null
      }
      const result = await Promise.race([
        initializationResult.call(activeQuery),
        timeoutResult,
      ])
      return result?.account ?? null
    }
    finally {
      closeClaudeQuery(activeQuery)
    }
  }
  catch {
    return null
  }
  finally {
    if (timeout) {
      clearTimeout(timeout)
    }
    if (!abortController.signal.aborted) {
      abortController.abort()
    }
  }
}

async function* emptyClaudeAgentProbeInput(signal: AbortSignal): AsyncGenerator<SDKUserMessage> {
  await waitForAbortSignal(signal)
}

function waitForAbortSignal(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true })
  })
}

function closeClaudeQuery(activeQuery: ClaudeAgentAccountProbeQuery): void {
  activeQuery.close?.()
}

function projectClaudeAccount(account: AccountInfo | null): NonNullable<ClaudeAgentAuthDiagnostics['account']> | null {
  if (!account) {
    return null
  }
  return {
    email: account.email ?? null,
    organization: account.organization ?? null,
    subscriptionType: account.subscriptionType ?? null,
    tokenSource: account.tokenSource ?? null,
    apiKeySource: account.apiKeySource ?? null,
    apiProvider: account.apiProvider ?? null,
  }
}

function claudeAuthMetadata(input: {
  subscriptionType: string | null
  authMethod: string | null
}): { type: string, label: string } | null {
  if (normalizeClaudeAuthMethod(input.authMethod) === 'apiKey') {
    return { type: 'apiKey', label: 'Claude API Key' }
  }
  if (!input.subscriptionType) {
    return null
  }
  const subscriptionLabel = claudeSubscriptionLabel(input.subscriptionType)
  return {
    type: input.subscriptionType,
    label: `Claude ${subscriptionLabel} Subscription`,
  }
}

function normalizeClaudeAuthMethod(authMethod: string | null): string | null {
  const normalized = authMethod?.toLowerCase().replace(/[\s_-]+/g, '')
  if (!normalized) {
    return null
  }
  return normalized === 'apikey' ? 'apiKey' : null
}

function claudeSubscriptionLabel(subscriptionType: string): string {
  const normalized = subscriptionType.toLowerCase().replace(/[\s_-]+/g, '')
  switch (normalized) {
    case 'max':
    case 'maxplan':
    case 'max5':
    case 'max20':
      return 'Max'
    case 'enterprise':
      return 'Enterprise'
    case 'team':
      return 'Team'
    case 'pro':
      return 'Pro'
    case 'free':
      return 'Free'
    default:
      return toTitleCaseWords(subscriptionType)
  }
}

function toTitleCaseWords(value: string): string {
  return value
    .split(/[\s_-]+/g)
    .filter(Boolean)
    .map(part => `${part[0]!.toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(' ')
}

function parseGenericCliVersion(output: string): string | null {
  const trimmed = output.trim()
  if (!trimmed) {
    return null
  }
  const match = /\b\d+(?:\.\d+){1,3}(?:[-+][0-9A-Z.-]+)?\b/i.exec(trimmed)
  return match?.[0] ?? trimmed.split(/\s+/)[0] ?? null
}

function detailFromResult(result: CommandResult): string | null {
  const stderr = result.stderr.trim()
  if (stderr) {
    return stderr
  }
  const stdout = result.stdout.trim()
  if (stdout) {
    return stdout
  }
  return result.code === 0 ? null : `Command exited with code ${result.code}.`
}

function isMissingCommandError(error: Error): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return code === 'ENOENT' || error.message.toLowerCase().includes('enoent')
}

function errorMessage(error: Error): string {
  return error.message || String(error)
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
