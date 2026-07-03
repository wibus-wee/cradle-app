import type { RuntimeCatalogItem } from '~/features/agent-runtime/runtime-catalog'
import type { ApiProviderKind } from '~/features/agent-runtime/types'

export type RuntimeSettingsFieldType = 'string' | 'boolean' | 'number' | 'integer'
export type RuntimeSettingsFormValue = string | number | boolean

export interface RuntimeSettingsEnumOption {
  value: RuntimeSettingsFormValue
  label: string
}

export interface RuntimeSettingsFieldDescriptor {
  runtimeKind: string
  runtimeLabel: string
  key: string
  label: string
  description?: string
  required: boolean
  type: RuntimeSettingsFieldType
  defaultValue?: RuntimeSettingsFormValue
  enumOptions?: RuntimeSettingsEnumOption[]
}

type RuntimeSettingsObjectSchema = {
  type?: unknown
  required?: unknown
  properties?: unknown
}

type RuntimeSettingsPropertySchema = {
  type?: unknown
  title?: unknown
  description?: unknown
  default?: unknown
  enum?: unknown
}

export function listRuntimeSettingsDescriptorsForProviderKind(
  runtimes: RuntimeCatalogItem[],
  providerKind: ApiProviderKind,
): RuntimeCatalogItem[] {
  return runtimes
    .filter(runtime =>
      runtime.settingsSchema
      && runtime.providerKinds.includes(providerKind))
    .sort((left, right) =>
      (left.sortOrder ?? 1000) - (right.sortOrder ?? 1000)
      || left.label.localeCompare(right.label)
      || left.runtimeKind.localeCompare(right.runtimeKind))
}

export function listRuntimeSettingsFields(
  runtimes: RuntimeCatalogItem[],
): RuntimeSettingsFieldDescriptor[] {
  return runtimes.flatMap((runtime) => {
    const schema = readObjectSchema(runtime.settingsSchema)
    if (!schema) {
      return []
    }

    const requiredKeys = readRequiredKeys(schema.required)
    return Object.entries(schema.properties)
      .flatMap(([key, rawProperty]) => {
        const property = readPropertySchema(rawProperty)
        const type = property ? readFieldType(property) : null
        if (!property || !type) {
          return []
        }

        return [{
          runtimeKind: runtime.runtimeKind,
          runtimeLabel: runtime.label,
          key,
          label: readString(property.title) ?? titleFromPropertyKey(key),
          description: readString(property.description) ?? undefined,
          required: requiredKeys.has(key),
          type,
          defaultValue: readFormValue(property.default, type),
          enumOptions: readEnumOptions(property.enum, type),
        }]
      })
  })
}

export function readRuntimeSettingsFormValues(
  config: Record<string, unknown>,
  fields: RuntimeSettingsFieldDescriptor[],
): Record<string, RuntimeSettingsFormValue> {
  const values: Record<string, RuntimeSettingsFormValue> = {}
  for (const field of fields) {
    const configValue = readFormValue(config[field.key], field.type)
    if (configValue !== undefined) {
      values[field.key] = configValue
      continue
    }
    if (field.defaultValue !== undefined) {
      values[field.key] = field.defaultValue
      continue
    }
    values[field.key] = emptyValueForFieldType(field.type)
  }
  return values
}

export function writeRuntimeSettingsConfig(
  config: Record<string, unknown>,
  fields: RuntimeSettingsFieldDescriptor[],
  values: Record<string, RuntimeSettingsFormValue | undefined>,
): Record<string, unknown> {
  if (fields.length === 0) {
    return config
  }

  const next = { ...config }
  for (const field of fields) {
    const value = readFormValue(values[field.key], field.type)
    if (value === undefined) {
      continue
    }
    next[field.key] = value
  }
  return next
}

function readObjectSchema(value: unknown): { required: unknown, properties: Record<string, unknown> } | null {
  const schema = readObjectRecord(value) as RuntimeSettingsObjectSchema | null
  if (!schema) {
    return null
  }
  if (schema.type !== undefined && schema.type !== 'object') {
    return null
  }
  const properties = readObjectRecord(schema.properties)
  if (!properties) {
    return null
  }
  return {
    required: schema.required,
    properties,
  }
}

function readPropertySchema(value: unknown): RuntimeSettingsPropertySchema | null {
  return readObjectRecord(value) as RuntimeSettingsPropertySchema | null
}

function readFieldType(property: RuntimeSettingsPropertySchema): RuntimeSettingsFieldType | null {
  const type = Array.isArray(property.type)
    ? property.type.find(item => typeof item === 'string' && item !== 'null')
    : property.type
  if (type === 'string' || type === 'boolean' || type === 'number' || type === 'integer') {
    return type
  }

  const enumValues = Array.isArray(property.enum) ? property.enum : []
  const enumType = enumValues.find(value => value !== null)
  if (typeof enumType === 'string') {
    return 'string'
  }
  if (typeof enumType === 'boolean') {
    return 'boolean'
  }
  if (typeof enumType === 'number') {
    return Number.isInteger(enumType) ? 'integer' : 'number'
  }
  return null
}

function readRequiredKeys(value: unknown): Set<string> {
  return new Set(
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [],
  )
}

function readEnumOptions(value: unknown, type: RuntimeSettingsFieldType): RuntimeSettingsEnumOption[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const options = value.flatMap((item) => {
    const formValue = readFormValue(item, type)
    return formValue === undefined
      ? []
      : [{ value: formValue, label: String(formValue) }]
  })
  return options.length > 0 ? options : undefined
}

function readFormValue(value: unknown, type: RuntimeSettingsFieldType): RuntimeSettingsFormValue | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  if (type === 'boolean') {
    return typeof value === 'boolean' ? value : undefined
  }
  if (type === 'number' || type === 'integer') {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return type === 'integer' ? Math.trunc(value) : value
    }
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) {
        return type === 'integer' ? Math.trunc(parsed) : parsed
      }
    }
    return undefined
  }
  if (typeof value === 'string') {
    return value
  }
  return String(value)
}

function emptyValueForFieldType(type: RuntimeSettingsFieldType): RuntimeSettingsFormValue {
  if (type === 'boolean') {
    return false
  }
  if (type === 'number' || type === 'integer') {
    return 0
  }
  return ''
}

function readObjectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function titleFromPropertyKey(key: string): string {
  return key
    .replaceAll(/[_-]+/g, ' ')
    .replaceAll(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, char => char.toUpperCase())
}
