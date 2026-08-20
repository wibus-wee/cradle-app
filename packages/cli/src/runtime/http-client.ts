import type { CliHttpMethod } from './types'
import { z } from 'zod'

const PATH_PARAM_RE = /\{([^}]+)\}/g
const CRADLE_CHAT_SESSION_ID_HEADER = 'x-cradle-chat-session-id'
const CRADLE_RUNTIME_ENV_KEYS = [
  'CRADLE_AGENT_HOME',
  'CRADLE_AGENT_ID',
  'CRADLE_WORKSPACE_ID',
  'CRADLE_WORKSPACE_PATH',
] as const
const HttpErrorPayloadJsonSchema = z.string()
  .transform(value => JSON.parse(value))
  .pipe(z.object({ message: z.string() }).passthrough())
const HttpResponseJsonSchema = z.string()
  .transform(value => JSON.parse(value))
  .pipe(z.unknown())
const PathParamValueSchema = z.union([
  z.string().min(1),
  z.number(),
  z.boolean(),
]).transform(value => encodeURIComponent(String(value)))
const QueryParamValuesSchema = z.union([
  z.array(z.unknown()).transform(values => values.map(value => String(value))),
  z.string().transform(value => value ? [value] : []),
  z.number().transform(value => [String(value)]),
  z.boolean().transform(value => [String(value)]),
  z.null().transform(() => []),
  z.undefined().transform(() => []),
])
const QueryEntriesSchema = z.record(z.string(), z.unknown()).transform(query =>
  Object.entries(query).flatMap(([key, value]) =>
    QueryParamValuesSchema.parse(value).map(item => [key, item] as const),
  ),
)

interface RequestInput {
  body?: unknown
  method: CliHttpMethod
  path: Record<string, unknown>
  query: Record<string, unknown>
  serverUrl: string
  template: string
}

function serializePath(template: string, values: Record<string, unknown>): string {
  return template.replace(PATH_PARAM_RE, (_, key: string) => {
    return PathParamValueSchema.parse(values[key])
  })
}

function appendQuery(url: URL, query: Record<string, unknown>): void {
  for (const [key, value] of QueryEntriesSchema.parse(query)) {
    url.searchParams.append(key, value)
  }
}

function isIssueMutation(input: Pick<RequestInput, 'method' | 'template'>): boolean {
  const method = input.method.toLowerCase()
  return method !== 'get' && method !== 'head' && /^\/issues(?:\/|$)/.test(input.template)
}

function isCradleRuntimeEnv(env: NodeJS.ProcessEnv): boolean {
  return CRADLE_RUNTIME_ENV_KEYS.some(key => Boolean(env[key]?.trim()))
}

function assertIssueMutationRuntimeContext(input: Pick<RequestInput, 'method' | 'template'>, chatSessionId: string | undefined): void {
  if (chatSessionId || !isIssueMutation(input) || !isCradleRuntimeEnv(process.env)) {
    return
  }

  throw new Error('Issue mutations from a Cradle runtime require CRADLE_CHAT_SESSION_ID so Activity can record the real actor.')
}

async function readError(response: Response): Promise<string> {
  const text = await response.text()
  if (!text) {
    return `${response.status} ${response.statusText}`
  }
  return HttpErrorPayloadJsonSchema.parse(text).message
}

export async function requestJson(input: RequestInput): Promise<unknown> {
  const path = serializePath(input.template, input.path)
  const url = new URL(path, input.serverUrl)
  appendQuery(url, input.query)

  const headers: Record<string, string> = {}
  if (input.body !== undefined) {
    headers['content-type'] = 'application/json'
  }
  const chatSessionId = process.env.CRADLE_CHAT_SESSION_ID?.trim()
  assertIssueMutationRuntimeContext(input, chatSessionId || undefined)
  if (chatSessionId) {
    headers[CRADLE_CHAT_SESSION_ID_HEADER] = chatSessionId
  }

  let response: Response
  try {
    response = await fetch(url, {
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
      headers: Object.keys(headers).length === 0 ? undefined : headers,
      method: input.method.toUpperCase(),
    })
  }
  catch {
    throw new Error(`Cannot connect to Cradle server at ${input.serverUrl}. Is the server running?`)
  }

  if (!response.ok) {
    throw new Error(await readError(response))
  }

  const text = await response.text()
  if (!text) {
    return undefined
  }
  return HttpResponseJsonSchema.parse(text)
}
