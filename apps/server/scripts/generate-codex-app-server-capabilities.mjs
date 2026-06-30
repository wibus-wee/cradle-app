import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const serverRoot = join(scriptDir, '..')
const codexRoot = join(serverRoot, 'src/modules/chat-runtime-providers/codex')
const protocolRoot = join(codexRoot, 'app-server-protocol')
const outputPath = join(codexRoot, 'app-server', 'capabilities.ts')

const streamClientMethods = new Set([
  'fs/watch',
  'turn/start',
  'thread/realtime/start',
  'thread/realtime/appendAudio',
  'thread/realtime/appendText',
  'thread/realtime/stop',
  'windowsSandbox/setupStart',
  'account/login/start',
  'command/exec',
  'process/spawn',
  'externalAgentConfig/import',
  'fuzzyFileSearch/sessionStart',
  'fuzzyFileSearch/sessionUpdate',
])

const manifest = JSON.parse(readFileSync(join(protocolRoot, 'MANIFEST.json'), 'utf8'))

const clientMethods = readRequestMethods('ClientRequest.ts').map(({ method, paramsType }) => ({
  method,
  paramsType: paramsType === 'undefined' ? null : paramsType,
  category: readMethodCategory(method),
  operation: readMethodOperation(method),
  interaction: streamClientMethods.has(method) ? 'stream' : 'request',
}))

const serverRequests = readRequestMethods('ServerRequest.ts').map(({ method, paramsType }) => ({
  method,
  paramsType,
  category: readMethodCategory(method),
}))

const serverNotifications = readNotificationMethods('ServerNotification.ts').map(({ method, paramsType }) => ({
  method,
  paramsType,
  category: readMethodCategory(method),
}))

writeFileSync(outputPath, `${renderHeader()}

export interface CodexAppServerMethodCapability {
  method: string
  paramsType: string | null
  category: string
  operation: string
  interaction: 'request' | 'stream'
}

export interface CodexAppServerServerMessageCapability {
  method: string
  paramsType: string
  category: string
}

export interface CodexAppServerCapabilityManifest {
  protocol: string
  generatorVersion: string
  generatedDate: string
  clientMethods: CodexAppServerMethodCapability[]
  serverRequests: CodexAppServerServerMessageCapability[]
  serverNotifications: CodexAppServerServerMessageCapability[]
}

const CODEX_APP_SERVER_PROTOCOL = ${renderTsValue(manifest.protocol)}
const CODEX_APP_SERVER_GENERATOR_VERSION = ${renderTsValue(manifest.generatorVersion)}
const CODEX_APP_SERVER_GENERATED_DATE = ${renderTsValue(manifest.generatedDate)}

export const CODEX_APP_SERVER_CLIENT_METHODS = ${renderArray(clientMethods)} as const satisfies readonly CodexAppServerMethodCapability[]

export const CODEX_APP_SERVER_SERVER_REQUESTS = ${renderArray(serverRequests)} as const satisfies readonly CodexAppServerServerMessageCapability[]

export const CODEX_APP_SERVER_SERVER_NOTIFICATIONS = ${renderArray(serverNotifications)} as const satisfies readonly CodexAppServerServerMessageCapability[]

export const CODEX_APP_SERVER_CLIENT_METHOD_SET = new Set<string>(
  CODEX_APP_SERVER_CLIENT_METHODS.map(method => method.method),
)

export const CODEX_APP_SERVER_CAPABILITIES = {
  protocol: CODEX_APP_SERVER_PROTOCOL,
  generatorVersion: CODEX_APP_SERVER_GENERATOR_VERSION,
  generatedDate: CODEX_APP_SERVER_GENERATED_DATE,
  clientMethods: [...CODEX_APP_SERVER_CLIENT_METHODS],
  serverRequests: [...CODEX_APP_SERVER_SERVER_REQUESTS],
  serverNotifications: [...CODEX_APP_SERVER_SERVER_NOTIFICATIONS],
} satisfies CodexAppServerCapabilityManifest

export function readCodexAppServerMethodCapability(method: string): CodexAppServerMethodCapability | null {
  return CODEX_APP_SERVER_CLIENT_METHODS.find(capability => capability.method === method) ?? null
}
`)

function readRequestMethods(fileName) {
  const source = readFileSync(join(protocolRoot, fileName), 'utf8')
  return Array.from(
    source.matchAll(/\{\s*"method": "([^"]+)",\s*id: RequestId,\s*params: ([^,]+),\s*\}/g),
    match => ({ method: match[1], paramsType: match[2].trim() }),
  )
}

function readNotificationMethods(fileName) {
  const source = readFileSync(join(protocolRoot, fileName), 'utf8')
  return Array.from(
    source.matchAll(/\{\s*"method": "([^"]+)",\s*"params": ([^}]+?)\s*\}/g),
    match => ({ method: match[1], paramsType: match[2].trim() }),
  )
}

function readMethodCategory(method) {
  return toKebabCase(method.includes('/') ? method.split('/')[0] : method)
}

function readMethodOperation(method) {
  if (!method.includes('/')) {
    return method
  }
  return method.split('/').slice(1).join('/')
}

function toKebabCase(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/_/g, '-')
    .toLowerCase()
}

function renderArray(items) {
  if (items.length === 0) {
    return '[]'
  }
  return `[
${items.map(item => `  ${renderObject(item)},`).join('\n')}
]`
}

function renderObject(item) {
  const entries = Object.entries(item).map(([key, value]) => {
    return `${key}: ${renderTsValue(value)}`
  })
  return `{ ${entries.join(', ')} }`
}

function renderTsValue(value) {
  if (value === null) {
    return 'null'
  }
  if (typeof value !== 'string') {
    return JSON.stringify(value)
  }
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, '\\\'')}'`
}

function renderHeader() {
  return `// GENERATED CODE! DO NOT MODIFY BY HAND!
// Run \`pnpm --filter @cradle/server generate:codex-app-server-capabilities\` after regenerating Codex app-server protocol bindings.`
}
