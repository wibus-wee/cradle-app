import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import type { Static } from 'elysia'
import type { Dispatcher } from 'undici'
import { EnvHttpProxyAgent, ProxyAgent, Socks5ProxyAgent } from 'undici'

import type { PreferencesModel } from '../modules/preferences/model'
import { getNetworkPreferencesSync } from '../modules/preferences/service'

type NetworkPreferences = Static<typeof PreferencesModel['networkPreferences']>
type NetworkProxyStatus = Static<typeof PreferencesModel['networkProxyStatus']>
interface ResolvedNetworkProxy {
  status: NetworkProxyStatus
  proxyUrl: string | null
}
interface DispatcherRequestInit extends RequestInit {
  dispatcher?: Dispatcher
}

const execFileAsync = promisify(execFile)
const SYSTEM_PROXY_CACHE_MS = 5_000
const SYSTEM_PROXY_READ_TIMEOUT_MS = 1_500
const dispatcherCache = new Map<string, Dispatcher>()

let envDispatcher: EnvHttpProxyAgent | null = null
let systemProxyCache: {
  platform: NodeJS.Platform
  targetProtocol: 'http:' | 'https:'
  targetHost: string
  resolved: ResolvedNetworkProxy
  expiresAt: number
} | null = null

export async function outboundFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const preferences = getNetworkPreferencesSync()
  const resolved = await resolveNetworkProxyForRequest(preferences, input)
  if (!resolved.status.enabled || !resolved.proxyUrl) {
    return fetch(input, init)
  }

  const dispatcher = getDispatcherForProxy(resolved.proxyUrl, resolved.status.source)
  const requestInit: DispatcherRequestInit = {
    ...init,
    dispatcher,
  }
  return fetch(input, requestInit)
}

export async function getOutboundNetworkStatus(): Promise<NetworkProxyStatus> {
  return (await resolveNetworkProxyForRequest(getNetworkPreferencesSync(), 'https://auth.openai.com/')).status
}

export async function resolveNetworkProxyStatusForRequest(
  preferences: NetworkPreferences,
  requestInput: RequestInfo | URL,
): Promise<NetworkProxyStatus> {
  return (await resolveNetworkProxyForRequest(preferences, requestInput)).status
}

async function resolveNetworkProxyForRequest(
  preferences: NetworkPreferences,
  requestInput: RequestInfo | URL,
): Promise<ResolvedNetworkProxy> {
  if (!preferences.proxyEnabled) {
    return {
      status: createStatus({
        enabled: false,
        mode: 'off',
        source: 'none',
        proxyUrl: null,
        reason: null,
      }),
      proxyUrl: null,
    }
  }

  const requestUrl = requestUrlFromInput(requestInput)

  if (preferences.proxyMode === 'custom') {
    const hasCustomProxyUrl = Boolean(preferences.customProxyUrl?.trim())
    const proxyUrl = normalizeProxyUrl(preferences.customProxyUrl)
    return {
      status: createStatus({
        enabled: true,
        mode: 'custom',
        source: proxyUrl ? 'custom' : 'none',
        proxyUrl: proxyUrl ? redactProxyUrl(proxyUrl) : null,
        reason: proxyUrl ? null : hasCustomProxyUrl ? 'customProxyInvalid' : 'customProxyMissing',
      }),
      proxyUrl,
    }
  }

  if (preferences.proxyMode === 'environment') {
    const proxyUrl = readEnvironmentProxyUrl(requestUrl.protocol, requestUrl.hostname)
    return {
      status: createStatus({
        enabled: true,
        mode: 'environment',
        source: proxyUrl ? 'environment' : 'none',
        proxyUrl: proxyUrl ? redactProxyUrl(proxyUrl) : null,
        reason: proxyUrl ? null : 'environmentProxyNotConfigured',
      }),
      proxyUrl,
    }
  }

  return resolveSystemProxy(requestUrl)
}

function requestUrlFromInput(input: RequestInfo | URL): URL {
  if (typeof input === 'string') {
    return new URL(input)
  }
  if (input instanceof URL) {
    return input
  }
  return new URL(input.url)
}

async function resolveSystemProxy(requestUrl: URL): Promise<ResolvedNetworkProxy> {
  const targetProtocol = requestUrl.protocol === 'http:' ? 'http:' : 'https:'
  const targetHost = requestUrl.hostname
  const cached = systemProxyCache
  if (
    cached
    && cached.platform === process.platform
    && cached.targetProtocol === targetProtocol
    && cached.targetHost === targetHost
    && cached.expiresAt > Date.now()
  ) {
    return {
      ...cached.resolved,
      status: {
        ...cached.resolved.status,
        checkedAt: new Date().toISOString(),
      },
    }
  }

  const resolved = process.platform === 'darwin'
    ? await readMacSystemProxy(requestUrl)
    : process.platform === 'win32'
      ? await readWindowsSystemProxy(requestUrl)
      : {
          status: createStatus({
            enabled: true,
            mode: 'system',
            source: 'none',
            proxyUrl: null,
            reason: 'systemProxyUnsupported',
          }),
          proxyUrl: null,
        }

  systemProxyCache = {
    platform: process.platform,
    targetProtocol,
    targetHost,
    resolved,
    expiresAt: Date.now() + SYSTEM_PROXY_CACHE_MS,
  }
  return resolved
}

async function readMacSystemProxy(requestUrl: URL): Promise<ResolvedNetworkProxy> {
  try {
    const { stdout } = await execFileAsync('scutil', ['--proxy'], {
      encoding: 'utf8',
      timeout: SYSTEM_PROXY_READ_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 64 * 1024,
    })
    const settings = parseMacScutilProxy(stdout)
    const bypassRules = settings.exceptions
    if (shouldBypassProxy(requestUrl.hostname, bypassRules, settings.excludeSimpleHostnames)) {
      return {
        status: createStatus({
          enabled: true,
          mode: 'system',
          source: 'none',
          proxyUrl: null,
          reason: 'systemProxyBypassed',
        }),
        proxyUrl: null,
      }
    }

    const proxyUrl = requestUrl.protocol === 'http:'
      ? settings.httpProxyUrl ?? settings.httpsProxyUrl ?? settings.socksProxyUrl
      : settings.httpsProxyUrl ?? settings.httpProxyUrl ?? settings.socksProxyUrl
    if (proxyUrl) {
      return {
        status: createStatus({
          enabled: true,
          mode: 'system',
          source: 'system',
          proxyUrl: redactProxyUrl(proxyUrl),
          reason: null,
        }),
        proxyUrl,
      }
    }
    return {
      status: createStatus({
        enabled: true,
        mode: 'system',
        source: 'none',
        proxyUrl: null,
        reason: settings.autoConfigUrl ? 'systemProxyPacUnsupported' : 'systemProxyNotConfigured',
      }),
      proxyUrl: null,
    }
  }
  catch (error) {
    return {
      status: createStatus({
        enabled: true,
        mode: 'system',
        source: 'none',
        proxyUrl: null,
        reason: error instanceof Error ? `systemProxyReadFailed:${error.message}` : 'systemProxyReadFailed',
      }),
      proxyUrl: null,
    }
  }
}

async function readWindowsSystemProxy(requestUrl: URL): Promise<ResolvedNetworkProxy> {
  try {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      [
        '$settings = Get-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";',
        '[pscustomobject]@{',
        'ProxyEnable = [int]($settings.ProxyEnable);',
        'ProxyServer = [string]($settings.ProxyServer);',
        'ProxyOverride = [string]($settings.ProxyOverride);',
        'AutoConfigURL = [string]($settings.AutoConfigURL)',
        '} | ConvertTo-Json -Compress',
      ].join(' '),
    ], {
      encoding: 'utf8',
      timeout: SYSTEM_PROXY_READ_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 64 * 1024,
    })
    const settings = parseWindowsProxySettings(stdout)
    const bypassRules = splitWindowsProxyOverride(settings.proxyOverride)
    if (shouldBypassProxy(requestUrl.hostname, bypassRules, false)) {
      return {
        status: createStatus({
          enabled: true,
          mode: 'system',
          source: 'none',
          proxyUrl: null,
          reason: 'systemProxyBypassed',
        }),
        proxyUrl: null,
      }
    }
    if (!settings.proxyEnable) {
      return {
        status: createStatus({
          enabled: true,
          mode: 'system',
          source: 'none',
          proxyUrl: null,
          reason: settings.autoConfigUrl ? 'systemProxyPacUnsupported' : 'systemProxyNotConfigured',
        }),
        proxyUrl: null,
      }
    }
    const proxyUrl = selectWindowsProxyUrl(settings.proxyServer, requestUrl.protocol)
    return {
      status: createStatus({
        enabled: true,
        mode: 'system',
        source: proxyUrl ? 'system' : 'none',
        proxyUrl: proxyUrl ? redactProxyUrl(proxyUrl) : null,
        reason: proxyUrl ? null : 'systemProxyNotConfigured',
      }),
      proxyUrl,
    }
  }
  catch (error) {
    return {
      status: createStatus({
        enabled: true,
        mode: 'system',
        source: 'none',
        proxyUrl: null,
        reason: error instanceof Error ? `systemProxyReadFailed:${error.message}` : 'systemProxyReadFailed',
      }),
      proxyUrl: null,
    }
  }
}

function createStatus(input: Omit<NetworkProxyStatus, 'checkedAt'>): NetworkProxyStatus {
  return {
    ...input,
    checkedAt: new Date().toISOString(),
  }
}

function getDispatcherForProxy(redactedProxyUrl: string, source: NetworkProxyStatus['source']): Dispatcher {
  if (source === 'environment') {
    envDispatcher ??= new EnvHttpProxyAgent()
    return envDispatcher
  }

  const dispatcher = dispatcherCache.get(redactedProxyUrl)
  if (dispatcher) {
    return dispatcher
  }

  const created = redactedProxyUrl.startsWith('socks:')
    || redactedProxyUrl.startsWith('socks5:')
    ? new Socks5ProxyAgent(redactedProxyUrl)
    : new ProxyAgent(redactedProxyUrl)
  dispatcherCache.set(redactedProxyUrl, created)
  return created
}

function readEnvironmentProxyUrl(protocol: string, hostname: string): string | null {
  const noProxyRules = splitEnvironmentNoProxy()
  if (shouldBypassProxy(hostname, noProxyRules, false)) {
    return null
  }
  const candidates = protocol === 'http:'
    ? [process.env.HTTP_PROXY, process.env.http_proxy, process.env.ALL_PROXY, process.env.all_proxy]
    : [process.env.HTTPS_PROXY, process.env.https_proxy, process.env.HTTP_PROXY, process.env.http_proxy, process.env.ALL_PROXY, process.env.all_proxy]
  const proxyUrl = candidates.find(value => value?.trim())
  return normalizeProxyUrl(proxyUrl ?? null)
}

export function normalizeProxyUrl(value: string | null | undefined): string | null {
  const raw = value?.trim()
  if (!raw) {
    return null
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`
  try {
    const url = new URL(withScheme)
    if (!['http:', 'https:', 'socks:', 'socks5:'].includes(url.protocol) || !url.hostname) {
      return null
    }
    return url.toString()
  }
  catch {
    return null
  }
}

function redactProxyUrl(value: string): string {
  const url = new URL(value)
  if (url.password) {
    url.password = '****'
  }
  return url.toString()
}

export function parseMacScutilProxy(raw: string): {
  httpProxyUrl: string | null
  httpsProxyUrl: string | null
  socksProxyUrl: string | null
  autoConfigUrl: string | null
  exceptions: string[]
  excludeSimpleHostnames: boolean
} {
  const values = new Map<string, string>()
  const exceptions: string[] = []
  let insideExceptions = false
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }
    if (trimmed.startsWith('ExceptionsList')) {
      insideExceptions = true
      continue
    }
    if (insideExceptions) {
      if (trimmed === '}') {
        insideExceptions = false
        continue
      }
      const match = trimmed.match(/^\d+\s*:\s*(.+)$/)
      if (match?.[1]) {
        exceptions.push(match[1].trim())
      }
      continue
    }
    const match = trimmed.match(/^([A-Z0-9]+)\s*:\s*(.+)$/i)
    if (match?.[1] && match[2]) {
      values.set(match[1], match[2].trim())
    }
  }

  return {
    httpProxyUrl: buildEnabledProxyUrl(values.get('HTTPEnable'), values.get('HTTPProxy'), values.get('HTTPPort'), 'http'),
    httpsProxyUrl: buildEnabledProxyUrl(values.get('HTTPSEnable'), values.get('HTTPSProxy'), values.get('HTTPSPort'), 'http'),
    socksProxyUrl: buildEnabledProxyUrl(values.get('SOCKSEnable'), values.get('SOCKSProxy'), values.get('SOCKSPort'), 'socks5'),
    autoConfigUrl: values.get('ProxyAutoConfigURLString') ?? null,
    exceptions,
    excludeSimpleHostnames: values.get('ExcludeSimpleHostnames') === '1',
  }
}

export function parseWindowsProxySettings(raw: string): {
  proxyEnable: boolean
  proxyServer: string | null
  proxyOverride: string | null
  autoConfigUrl: string | null
} {
  const parsed = JSON.parse(raw) as {
    ProxyEnable?: number | string | null
    ProxyServer?: string | null
    ProxyOverride?: string | null
    AutoConfigURL?: string | null
  }
  return {
    proxyEnable: Number(parsed.ProxyEnable ?? 0) === 1,
    proxyServer: parsed.ProxyServer?.trim() || null,
    proxyOverride: parsed.ProxyOverride?.trim() || null,
    autoConfigUrl: parsed.AutoConfigURL?.trim() || null,
  }
}

function buildEnabledProxyUrl(
  enabled: string | undefined,
  host: string | undefined,
  port: string | undefined,
  scheme: 'http' | 'socks5',
): string | null {
  if (enabled !== '1' || !host?.trim()) {
    return null
  }
  const hostPort = port?.trim() ? `${host.trim()}:${port.trim()}` : host.trim()
  return normalizeProxyUrl(`${scheme}://${hostPort}`)
}

export function selectWindowsProxyUrl(proxyServer: string | null, targetProtocol: string): string | null {
  if (!proxyServer) {
    return null
  }

  const entries = proxyServer.split(';').map(entry => entry.trim()).filter(Boolean)
  const byScheme = new Map<string, string>()
  for (const entry of entries) {
    const equalsIndex = entry.indexOf('=')
    if (equalsIndex === -1) {
      return normalizeProxyUrl(entry)
    }
    const key = entry.slice(0, equalsIndex).trim().toLowerCase()
    const value = entry.slice(equalsIndex + 1).trim()
    if (key && value) {
      byScheme.set(key, value)
    }
  }

  const selectedScheme = targetProtocol === 'http:'
    ? byScheme.has('http') ? 'http' : byScheme.has('https') ? 'https' : byScheme.has('socks') ? 'socks' : null
    : byScheme.has('https') ? 'https' : byScheme.has('http') ? 'http' : byScheme.has('socks') ? 'socks' : null
  if (!selectedScheme) {
    return null
  }
  const selected = byScheme.get(selectedScheme)
  return normalizeProxyUrl(selectedScheme === 'socks' ? `socks5://${selected}` : selected)
}

function splitWindowsProxyOverride(value: string | null): string[] {
  return value?.split(';').map(entry => entry.trim()).filter(Boolean) ?? []
}

function splitEnvironmentNoProxy(): string[] {
  return (process.env.NO_PROXY ?? process.env.no_proxy)
    ?.split(',')
    .map(entry => entry.trim())
    .filter(Boolean) ?? []
}

export function shouldBypassProxy(hostname: string, rules: string[], excludeSimpleHostnames: boolean): boolean {
  const host = hostname.toLowerCase()
  if (excludeSimpleHostnames && !host.includes('.')) {
    return true
  }
  return rules.some((rule) => {
    const normalized = rule.trim().toLowerCase()
    if (!normalized) {
      return false
    }
    if (normalized === '<local>') {
      return !host.includes('.')
    }
    if (normalized === '*') {
      return true
    }
    if (normalized.startsWith('*.')) {
      return host.endsWith(normalized.slice(1))
    }
    if (normalized.startsWith('.')) {
      return host.endsWith(normalized)
    }
    if (normalized.includes('*')) {
      const pattern = normalized.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
      return new RegExp(`^${pattern}$`).test(host)
    }
    return host === normalized
  })
}
