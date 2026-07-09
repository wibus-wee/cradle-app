export type CliHttpMethod = 'delete' | 'get' | 'patch' | 'post' | 'put'

export type CliValueType = 'boolean' | 'json' | 'number' | 'string' | 'string[]'
export type CliOutputFormat = 'agent' | 'auto' | 'json' | 'ndjson' | 'pretty' | 'table'

/**
 * Identifies a value that should be resolved through a runtime helper instead
 * of a plain env-var default. `workspace` resolves name-or-id input through
 * `resolveWorkspaceReference` (explicit value > CRADLE_WORKSPACE_ID > cwd
 * auto-detect), so humans never have to pass a raw workspace UUID.
 */
export type CliResolver = 'workspace'

export interface CliArgumentSpec {
  name: string
  description?: string
  envDefault?: string
  /** Human-facing flag/argument label, if different from `name` (e.g. `workspace` instead of `workspaceId`). */
  flagName?: string
  resolver?: CliResolver
  /** When resolver is set, whether omission falls back through env/cwd detection (true) or must be typed explicitly (false). Defaults to true. */
  resolverAmbient?: boolean
  target: string
  required?: boolean
  type?: CliValueType
}

export interface CliFlagSpec extends CliArgumentSpec {
  disableResolverFlag?: string
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
