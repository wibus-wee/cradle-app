import { Badge } from '~/components/ui/badge'
import { Input } from '~/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { Switch } from '~/components/ui/switch'

import { SettingsDivider, SettingsRow, SettingsSectionHeader } from '../settings/settings-row'
import type {
  RuntimeSettingsFieldDescriptor,
  RuntimeSettingsFormValue,
} from './runtime-settings-schema'

interface RuntimeSettingsSchemaFieldsProps {
  fields: RuntimeSettingsFieldDescriptor[]
  values: Record<string, RuntimeSettingsFormValue | undefined>
  onChange: (key: string, value: RuntimeSettingsFormValue) => void
}

export function RuntimeSettingsSchemaFields({
  fields,
  values,
  onChange,
}: RuntimeSettingsSchemaFieldsProps) {
  if (fields.length === 0) {
    return null
  }

  const sections = groupFieldsByRuntime(fields)
  return (
    <>
      {sections.map(section => (
        <section
          key={section.runtimeKind}
          data-testid={`runtime-settings-section-${section.runtimeKind}`}
          className="flex flex-col"
        >
          <SettingsDivider />
          <SettingsSectionHeader
            title={`${section.runtimeLabel} runtime settings`}
            description="Settings declared by the runtime descriptor."
            className="pb-1"
          />
          {section.fields.map((field, index) => (
            <div key={`${field.runtimeKind}:${field.key}`}>
              {index > 0 && <SettingsDivider />}
              <SettingsRow
                label={field.label}
                description={field.description}
                labelAccessory={field.required ? <Badge variant="secondary" className="text-[10px]">Required</Badge> : undefined}
              >
                <RuntimeSettingsFieldControl
                  field={field}
                  value={values[field.key]}
                  onChange={value => onChange(field.key, value)}
                />
              </SettingsRow>
            </div>
          ))}
        </section>
      ))}
    </>
  )
}

function RuntimeSettingsFieldControl({
  field,
  value,
  onChange,
}: {
  field: RuntimeSettingsFieldDescriptor
  value: RuntimeSettingsFormValue | undefined
  onChange: (value: RuntimeSettingsFormValue) => void
}) {
  const testId = `runtime-setting-${field.runtimeKind}-${field.key}`
  if (field.enumOptions?.length) {
    return (
      <Select
        value={stringValue(value)}
        onValueChange={(nextValue) => {
          const selected = field.enumOptions?.find(option => String(option.value) === nextValue)
          onChange(selected?.value ?? nextValue)
        }}
      >
        <SelectTrigger className="h-9 w-56 text-[12.5px]" data-testid={testId}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {field.enumOptions.map(option => (
            <SelectItem key={String(option.value)} value={String(option.value)}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  if (field.type === 'boolean') {
    return (
      <Switch
        data-testid={testId}
        checked={value === true}
        onCheckedChange={checked => onChange(checked)}
      />
    )
  }

  if (field.type === 'number' || field.type === 'integer') {
    return (
      <Input
        data-testid={testId}
        type="number"
        step={field.type === 'integer' ? 1 : 'any'}
        value={numberInputValue(value)}
        onChange={(event) => {
          const parsed = Number(event.target.value)
          onChange(Number.isFinite(parsed) ? parsed : 0)
        }}
        className="h-9 w-56 text-[12.5px] font-mono"
      />
    )
  }

  return (
    <Input
      data-testid={testId}
      value={stringValue(value)}
      onChange={event => onChange(event.target.value)}
      className="h-9 w-56 text-[12.5px] font-mono"
    />
  )
}

function groupFieldsByRuntime(fields: RuntimeSettingsFieldDescriptor[]): Array<{
  runtimeKind: string
  runtimeLabel: string
  fields: RuntimeSettingsFieldDescriptor[]
}> {
  const sections: Array<{
    runtimeKind: string
    runtimeLabel: string
    fields: RuntimeSettingsFieldDescriptor[]
  }> = []
  for (const field of fields) {
    const existing = sections.find(section => section.runtimeKind === field.runtimeKind)
    if (existing) {
      existing.fields.push(field)
      continue
    }
    sections.push({
      runtimeKind: field.runtimeKind,
      runtimeLabel: field.runtimeLabel,
      fields: [field],
    })
  }
  return sections
}

function stringValue(value: RuntimeSettingsFormValue | undefined): string {
  return value === undefined ? '' : String(value)
}

function numberInputValue(value: RuntimeSettingsFormValue | undefined): number | string {
  return typeof value === 'number' ? value : ''
}
