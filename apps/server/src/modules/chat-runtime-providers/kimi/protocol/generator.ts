import { createHash } from 'node:crypto'

export type KimiJsonPrimitive = boolean | number | string | null
export type KimiJsonValue = KimiJsonPrimitive | KimiJsonValue[] | { [key: string]: KimiJsonValue }

export interface KimiOpenApiDocument {
  openapi: string
  servers?: Array<{ url?: string }>
}

export interface KimiAsyncApiMessage {
  name?: string
  title?: string
  summary?: string
  payload?: KimiJsonValue
}

export interface KimiAsyncApiDocument {
  asyncapi: string
  servers?: Record<string, { host?: string }>
  operations?: Record<string, {
    action?: 'receive' | 'send'
    messages?: Array<{ $ref?: string }>
  }>
  components?: {
    messages?: Record<string, KimiAsyncApiMessage>
  }
}

export type KimiWebSocketMessageDirection = 'client_to_server' | 'server_to_client'

export interface KimiWebSocketMessage {
  name: string
  title: string | null
  summary: string | null
  direction: KimiWebSocketMessageDirection
  payload: KimiJsonValue | null
}

export interface KimiProtocolManifest {
  owner: string
  protocol: 'kimi-web'
  bindings: 'typescript'
  runtimeVersion: string
  openapiVersion: string
  asyncapiVersion: string
  openapiSha256: string
  asyncapiSha256: string
  restGenerator: '@hey-api/openapi-ts'
  command: string
  generatedDate: string
  notes: string[]
}

export function normalizeKimiOpenApiDocument(document: KimiOpenApiDocument): KimiOpenApiDocument {
  const normalized: KimiOpenApiDocument = structuredClone(document)
  if (normalized.servers) {
    normalized.servers = normalized.servers.map(server => ({
      ...server,
      ...(server.url ? { url: normalizeKimiServerUrl(server.url) } : {}),
    }))
  }
  return sortJsonValue(normalized) as KimiOpenApiDocument
}

export function normalizeKimiAsyncApiDocument(document: KimiAsyncApiDocument): KimiAsyncApiDocument {
  const normalized: KimiAsyncApiDocument = structuredClone(document)
  if (normalized.servers) {
    normalized.servers = Object.fromEntries(
      Object.entries(normalized.servers).map(([name, server]) => [
        name,
        {
          ...server,
          ...(server.host ? { host: normalizeKimiServerHost(server.host) } : {}),
        },
      ]),
    )
  }
  return sortJsonValue(normalized) as KimiAsyncApiDocument
}

export function createKimiProtocolManifest(input: {
  runtimeVersion: string
  openapi: KimiOpenApiDocument
  asyncapi: KimiAsyncApiDocument
  generatedDate: string
}): KimiProtocolManifest {
  return {
    owner: 'apps/server/src/modules/chat-runtime-providers/kimi',
    protocol: 'kimi-web',
    bindings: 'typescript',
    runtimeVersion: input.runtimeVersion,
    openapiVersion: input.openapi.openapi,
    asyncapiVersion: input.asyncapi.asyncapi,
    openapiSha256: sha256Json(input.openapi),
    asyncapiSha256: sha256Json(input.asyncapi),
    restGenerator: '@hey-api/openapi-ts',
    command: 'pnpm --filter @cradle/server generate:kimi-web-protocol',
    generatedDate: input.generatedDate,
    notes: [
      'The running Kimi CLI is the protocol source of truth.',
      'Loopback port values are normalized to {port} before snapshots are committed.',
      'The temporary KIMI_CODE_HOME and its bearer token are never committed or logged.',
    ],
  }
}

export function readKimiWebSocketMessages(document: KimiAsyncApiDocument): KimiWebSocketMessage[] {
  const messages = document.components?.messages ?? {}
  const directions = new Map<string, KimiWebSocketMessageDirection>()

  for (const operation of Object.values(document.operations ?? {})) {
    const direction = operation.action === 'receive' ? 'client_to_server' : 'server_to_client'
    for (const reference of operation.messages ?? []) {
      if (reference.$ref) {
        directions.set(reference.$ref, direction)
      }
    }
  }

  return Object.entries(messages)
    .map(([messageId, message]): KimiWebSocketMessage => {
      const reference = `#/components/messages/${messageId}`
      const direction = directions.get(reference)
      if (!direction) {
        throw new Error(`AsyncAPI message ${messageId} is not referenced by an operation.`)
      }
      if (!message.name) {
        throw new Error(`AsyncAPI message ${messageId} has no name.`)
      }
      return {
        name: message.name,
        title: message.title ?? null,
        summary: message.summary ?? null,
        direction,
        payload: message.payload ?? null,
      }
    })
    .sort((left, right) => left.name.localeCompare(right.name))
}

export function renderKimiWebSocketCatalogue(document: KimiAsyncApiDocument): string {
  const messages = readKimiWebSocketMessages(document)
  return `// GENERATED CODE! DO NOT MODIFY BY HAND.\n// Run \`pnpm --filter @cradle/server generate:kimi-web-protocol-bindings\`.\n\nexport type KimiWebSocketMessageDirection = 'client_to_server' | 'server_to_client'\n\nexport interface KimiWebSocketMessage {\n  name: string\n  title: string | null\n  summary: string | null\n  direction: KimiWebSocketMessageDirection\n  payload: unknown\n}\n\nexport const KIMI_WEB_SOCKET_MESSAGES = ${JSON.stringify(messages, null, 2)} as const satisfies readonly KimiWebSocketMessage[]\n\nexport type KimiWebSocketMessageName = (typeof KIMI_WEB_SOCKET_MESSAGES)[number]['name']\n`
}

export function stringifyKimiJson(value: object): string {
  return `${JSON.stringify(sortJsonValue(value), null, 2)}\n`
}

function sha256Json(value: object): string {
  return createHash('sha256').update(stringifyKimiJson(value)).digest('hex')
}

function normalizeKimiServerUrl(value: string): string {
  const url = new URL(value)
  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
    return value.replace(/^(https?:\/\/(?:127\.0\.0\.1|localhost)):\d+/, '$1:{port}')
  }
  return value
}

function normalizeKimiServerHost(value: string): string {
  if (value.startsWith('127.0.0.1:') || value.startsWith('localhost:')) {
    return `${value.slice(0, value.lastIndexOf(':'))}:{port}`
  }
  return value
}

function sortJsonValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue) as T
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJsonValue(entry)]),
    ) as T
  }
  return value
}
