type OpenApiRecord = Record<string, unknown>

export function normalizeConstSchemas(value: unknown): void {
  if (!value || typeof value !== 'object') {
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      normalizeConstSchemas(item)
    }
    return
  }

  const record = value as OpenApiRecord
  if (normalizeStringConstUnion(record)) {
    return
  }

  for (const child of Object.values(record)) {
    normalizeConstSchemas(child)
  }

  const constant = getStringConstSchemaValue(record)
  if (constant === null) {
    return
  }

  delete record.const
  record.type = 'string'
  record.enum = [constant]
}

function normalizeStringConstUnion(record: OpenApiRecord): boolean {
  const anyOf = record.anyOf
  if (!Array.isArray(anyOf) || anyOf.length === 0) {
    return false
  }

  const enumValues: string[] = []
  let nullable = record.nullable === true
  for (const schema of anyOf) {
    if (isNullSchema(schema)) {
      nullable = true
      continue
    }

    const enumValue = getStringConstSchemaValue(schema)
    if (enumValue === null) {
      return false
    }
    enumValues.push(enumValue)
  }

  if (enumValues.length === 0) {
    return false
  }

  delete record.anyOf
  record.type = 'string'
  record.enum = nullable ? [...new Set(enumValues), null] : [...new Set(enumValues)]
  if (nullable) {
    record.nullable = true
  }
  return true
}

function isNullSchema(value: unknown): boolean {
  return isOpenApiRecord(value) && value.type === 'null'
}

function getStringConstSchemaValue(value: unknown): string | null {
  if (!isOpenApiRecord(value)) {
    return null
  }
  if (value.type !== undefined && value.type !== 'string') {
    return null
  }
  return typeof value.const === 'string' ? value.const : null
}

function isOpenApiRecord(value: unknown): value is OpenApiRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
