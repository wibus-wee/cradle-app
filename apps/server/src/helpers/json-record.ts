export function readObjectRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function readOptionalObjectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function parseJsonObject(json: string): Record<string, unknown> {
  return readObjectRecord(JSON.parse(json) as unknown)
}

export function parseJsonObjectOrEmpty(json: string | null | undefined): Record<string, unknown> {
  try {
    return parseJsonObject(json ?? '{}')
  }
  catch {
    return {}
  }
}
