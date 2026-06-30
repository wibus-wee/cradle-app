export type CliHttpMethod = 'delete' | 'get' | 'patch' | 'post' | 'put'

export type CliValueType = 'boolean' | 'json' | 'number' | 'string' | 'string[]'
export type CliOutputFormat = 'agent' | 'auto' | 'json' | 'ndjson' | 'pretty' | 'table'

export interface CliArgumentSpec {
  name: string
  description?: string
  envDefault?: string
  target: string
  required?: boolean
  type?: CliValueType
}

export interface CliFlagSpec {
  name: string
  description?: string
  disableEnvDefaultFlag?: string
  envDefault?: string
  target: string
  required?: boolean
  type?: CliValueType
  values?: string[]
}

export interface CliOperationSpec {
  command: string[]
  description?: string
  method: CliHttpMethod
  path: string
  arguments?: CliArgumentSpec[]
  flags?: CliFlagSpec[]
}

export interface CommandContext {
  serverUrl: string
  request: (operation: {
    body?: unknown
    method: CliHttpMethod
    path: Record<string, unknown>
    query: Record<string, unknown>
    template: string
  }) => Promise<unknown>
}
