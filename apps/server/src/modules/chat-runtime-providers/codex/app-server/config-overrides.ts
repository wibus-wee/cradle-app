import { stringify } from 'smol-toml'

import type { JsonValue } from '../app-server-protocol/serde_json/JsonValue'

/** CLI overrides accept TOML values, including inline tables, rather than JSON objects. */
export function serializeConfigOverrides(config: Record<string, JsonValue | undefined>): string[] {
  return Object.entries(config)
    .filter((entry): entry is [string, JsonValue] => entry[1] !== undefined)
    .map(([key, value]) => `${key}=${toTomlValue(value)}`)
}

function toTomlValue(value: JsonValue): string {
  if (value === null) {
    throw new Error('Codex config cannot contain null; remove the setting to inherit its default')
  }
  if (Array.isArray(value)) {
    return `[${value.map(toTomlValue).join(', ')}]`
  }
  if (typeof value === 'object') {
    return `{ ${Object.entries(value)
      .map(([key, entry]) => `${JSON.stringify(key)} = ${toTomlValue(entry!)}`)
      .join(', ')} }`
  }
  return stringify({ value }).slice('value = '.length).trimEnd()
}
