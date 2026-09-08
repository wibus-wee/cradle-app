import type { GetProviderTargetsCodexConfigSchemaResponse } from '~/api-gen/types.gen'

/**
 * Narrow view of the upstream Codex `config.schema.json`. Only the shapes the
 * settings explorer understands are typed; everything else is ignored.
 */
export interface JsonSchemaNode {
  $ref?: string
  type?: string | string[]
  description?: string
  enum?: string[]
  default?: unknown
  format?: string
  items?: JsonSchemaNode
  properties?: Record<string, JsonSchemaNode>
  definitions?: Record<string, JsonSchemaNode>
  additionalProperties?: boolean | JsonSchemaNode
  allOf?: JsonSchemaNode[]
}

export interface JsonSchemaDocument extends JsonSchemaNode {
  properties?: Record<string, JsonSchemaNode>
  definitions?: Record<string, JsonSchemaNode>
}

export type CodexFieldKind = 'enum' | 'boolean' | 'string' | 'integer' | 'stringlist' | 'object'

export interface CodexFieldOption {
  value: string
  description?: string
}

export interface CodexField {
  /** Key as it appears in the Codex `config.toml`. */
  key: string
  kind: CodexFieldKind
  description?: string
  /** Enum values, when `kind` is 'enum'. */
  options?: CodexFieldOption[]
  /** Placeholder for free-form inputs, derived from the schema default. */
  placeholder?: string
  /** Declared sub-fields, when the structured value can render as a nested form. */
  children?: CodexField[]
  /**
   * Subschema for `object` fields, used by the inline fragment editor for
   * validation and autocomplete. Includes the root `definitions` so internal
   * `$ref`s resolve.
   */
  fragmentSchema?: JsonSchemaNode
}

export interface CodexFieldGroup {
  id: string
  label: string
  fields: CodexField[]
}

export interface CodexSchemaModel {
  version: string
  releaseTag: string
  source: string
  managedKeys: string[]
  /** Boolean feature flags from the `features` table. */
  flags: CodexField[]
  /** The first-class settings surfaced above the full schema explorer. */
  quickFields: CodexField[]
  /** All editable top-level settings (excluding `features` and quick fields), grouped for display. */
  groups: CodexFieldGroup[]
}

export type CodexConfig = Record<string, unknown>

/** First-class settings surfaced above the full schema explorer. */
const QUICK_FIELDS: ReadonlyArray<{ key: string, label: string, hint?: string }> = [
  { key: 'web_search', label: 'Web search' },
  { key: 'model_verbosity', label: 'Response verbosity' },
  { key: 'service_tier', label: 'Service tier', hint: 'Request id such as default, priority, or flex. Empty inherits the default.' },
]

const GROUP_DEFS: ReadonlyArray<{ id: string, label: string, match: (key: string) => boolean }> = [
  {
    id: 'model',
    label: 'Model',
    match: key => key.startsWith('model_') || ['compact_prompt', 'personality', 'plan_mode_reasoning_effort', 'review_model'].includes(key),
  },
  { id: 'interface', label: 'Interface', match: key => ['check_for_update_on_startup', 'disable_paste_burst', 'hide_agent_reasoning', 'notify', 'show_raw_agent_reasoning', 'suppress_unstable_features_warning', 'tui'].includes(key) },
  { id: 'instructions', label: 'Instructions', match: key => key.startsWith('include_') },
  { id: 'projects', label: 'Projects', match: key => key.startsWith('project_') },
  { id: 'mcp', label: 'MCP', match: key => key.startsWith('mcp_') },
  { id: 'experimental', label: 'Experimental', match: key => key.startsWith('experimental_') },
  { id: 'other', label: 'Other', match: () => true },
]

function placeholderFor(defaultValue: unknown): string | undefined {
  if (defaultValue === null || defaultValue === undefined) {
    return undefined
  }
  if (typeof defaultValue === 'string' && defaultValue) {
    return `Default: ${defaultValue}`
  }
  if (typeof defaultValue === 'number' || typeof defaultValue === 'boolean') {
    return `Default: ${String(defaultValue)}`
  }
  return undefined
}

function resolveRefWithName(
  document: JsonSchemaDocument,
  node: JsonSchemaNode,
): { name?: string, node?: JsonSchemaNode } {
  const ref = node.$ref ?? node.allOf?.[0]?.$ref
  if (!ref) {
    return {}
  }
  const name = ref.split('/').pop()
  return { name, node: name ? document.definitions?.[name] : undefined }
}

const MAX_FORM_DEPTH = 4

/**
 * Classifies one schema node into a form field. Structured nodes with declared
 * `properties` recurse into `children` (so they render as nested form rows);
 * maps, arrays of objects, and recursive/cyclic definitions fall back to a
 * `fragmentSchema` for the inline JSON editor.
 */
function classifyField(
  document: JsonSchemaDocument,
  key: string,
  node: JsonSchemaNode,
  depth = 0,
  seen: ReadonlySet<string> = new Set(),
): CodexField {
  const { name: refName, node: referenced } = resolveRefWithName(document, node)
  const cyclic = refName ? seen.has(refName) : false
  const resolved = cyclic ? undefined : referenced
  const enumValues = node.enum ?? resolved?.enum
  const description = node.description ?? resolved?.description
  const base: CodexField = { key, kind: 'object' }
  if (description) {
    base.description = description
  }
  if (enumValues) {
    base.kind = 'enum'
    base.options = enumValues.map((value): CodexFieldOption => ({ value }))
    return base
  }
  const rawType = node.type ?? resolved?.type
  const type = Array.isArray(rawType) ? rawType[0] : rawType
  if (type === 'boolean') {
    base.kind = 'boolean'
    return base
  }
  if (type === 'string' || type === 'integer' || type === 'number') {
    base.kind = type === 'string' ? 'string' : 'integer'
    const placeholder = placeholderFor(node.default ?? resolved?.default)
    if (placeholder) {
      base.placeholder = placeholder
    }
    return base
  }
  const items = node.items ?? resolved?.items
  const itemType = Array.isArray(items?.type) ? items.type[0] : items?.type
  if (type === 'array' && (itemType === 'string' || itemType === 'integer')) {
    base.kind = 'stringlist'
    return base
  }
  base.fragmentSchema = { ...node, definitions: document.definitions }
  const childProperties = resolved?.properties ?? node.properties
  if (childProperties && depth < MAX_FORM_DEPTH && !cyclic) {
    const nextSeen = refName ? new Set([...seen, refName]) : seen
    base.children = Object.entries(childProperties).map(([childKey, childNode]) =>
      classifyField(document, childKey, childNode, depth + 1, nextSeen))
  }
  return base
}

export function parseCodexSchema(schema: GetProviderTargetsCodexConfigSchemaResponse): CodexSchemaModel {
  const document = JSON.parse(schema.schemaJson) as JsonSchemaDocument
  const properties = document.properties ?? {}

  const flags: CodexField[] = []
  const features = properties.features
  const flagProperties = features?.type === 'object' ? features.properties ?? {} : {}
  for (const [key, node] of Object.entries(flagProperties)) {
    if (node.type === 'boolean') {
      flags.push(classifyField(document, key, node))
    }
  }

  const quickKeys = new Set(QUICK_FIELDS.map(field => field.key))
  const quickFields = QUICK_FIELDS.flatMap((field) => {
    const node = properties[field.key]
    return node ? [classifyField(document, field.key, node)] : []
  })
  const editable = Object.entries(properties)
    .filter(([key]) => key !== 'features' && !quickKeys.has(key))
    .map(([key, node]) => classifyField(document, key, node))

  const assigned = new Set<string>()
  const groups: CodexFieldGroup[] = GROUP_DEFS.map((group) => {
    const fields = editable.filter((field) => {
      if (assigned.has(field.key)) {
        return false
      }
      if (!group.match(field.key)) {
        return false
      }
      assigned.add(field.key)
      return true
    })
    return { id: group.id, label: group.label, fields }
  }).filter(group => group.fields.length > 0)

  return {
    version: schema.version,
    releaseTag: schema.releaseTag,
    source: schema.source,
    managedKeys: schema.managedKeys,
    flags,
    quickFields,
    groups,
  }
}

export function quickFieldMeta(key: string): { label: string, hint?: string } | undefined {
  return QUICK_FIELDS.find(field => field.key === key)
}

export function parseCodexConfig(value: string): { config: CodexConfig } | { error: string } {
  try {
    const parsed: unknown = JSON.parse(value)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { error: 'Configuration must be a JSON object.' }
    }
    return { config: parsed as CodexConfig }
  }
  catch {
    return { error: 'Enter a JSON object with valid configuration values.' }
  }
}

/** Returns a new config with `key` set to `value`; `undefined` removes the key so it inherits. */
export function setConfigValue(config: CodexConfig, key: string, value: unknown): CodexConfig {
  const next = { ...config }
  if (value === undefined) {
    delete next[key]
  }
  else {
    next[key] = value
  }
  return next
}

/** Returns a new config with a `features` flag set; `undefined` removes the flag. */
export function setConfigFlag(config: CodexConfig, key: string, value: boolean | undefined): CodexConfig {
  const features = typeof config.features === 'object' && config.features !== null && !Array.isArray(config.features)
    ? { ...(config.features as CodexConfig) }
    : {}
  if (value === undefined) {
    delete features[key]
  }
  else {
    features[key] = value
  }
  const next = { ...config }
  if (Object.keys(features).length) {
    next.features = features
  }
  else {
    delete next.features
  }
  return next
}

export function isOverridden(config: CodexConfig, key: string): boolean {
  return Object.hasOwn(config, key)
}

export function flagValue(config: CodexConfig, key: string): boolean | undefined {
  const features = config.features
  if (typeof features === 'object' && features !== null && !Array.isArray(features)) {
    const value = (features as CodexConfig)[key]
    return typeof value === 'boolean' ? value : undefined
  }
  return undefined
}

export function countOverrides(config: CodexConfig): number {
  return Object.keys(config).length
}

/** Reads the value at a nested `path`; returns `undefined` when any segment is missing. */
export function getPathValue(config: CodexConfig, path: string[]): unknown {
  let current: unknown = config
  for (const segment of path) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) {
      return undefined
    }
    current = (current as CodexConfig)[segment]
  }
  return current
}

/**
 * Returns a new config with the value at `path` set; `undefined` removes it and
 * prunes parent objects left empty, so clearing a leaf fully inherits again.
 */
export function setPathValue(config: CodexConfig, path: string[], value: unknown): CodexConfig {
  const [head, ...rest] = path
  if (!head) {
    return config
  }
  if (!rest.length) {
    return setConfigValue(config, head, value)
  }
  const child = typeof config[head] === 'object' && config[head] !== null && !Array.isArray(config[head])
    ? (config[head] as CodexConfig)
    : {}
  const nextChild = setPathValue(child, rest, value)
  return setConfigValue(config, head, Object.keys(nextChild).length ? nextChild : undefined)
}

export function isPathOverridden(config: CodexConfig, path: string[]): boolean {
  return getPathValue(config, path) !== undefined
}
