// Schema-driven composer control for provider-native runtime settings.
import {
  HammerLine as HammerIcon,
  LockLine as LockIcon,
  RouteLine as RouteIcon,
  SafeShieldLine as ShieldCheckIcon,
} from '@mingcute/react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import type { RuntimeCatalogItem } from '~/features/agent-runtime/runtime-catalog'
import type { RuntimeSettingsFieldDescriptor } from '~/features/agent-runtime/runtime-settings-schema'
import { cn } from '~/lib/cn'

import type { RuntimeSettings, RuntimeSettingsPatch } from '../commands/chat-response-command'
import {
  formatRuntimeSettingsSummary,
  labelRuntimeSettingsValue,
  readComposerRuntimeSettingsFields,
  readRuntimeSettingsIconKey,
} from './runtime-settings-presenter'

interface RuntimeSettingsControlProps {
  runtime: RuntimeCatalogItem | null | undefined
  settings: RuntimeSettings
  applied?: boolean
  disabled?: boolean
  showLabels?: boolean
  saving?: boolean
  onChange: (patch: RuntimeSettingsPatch) => void
}

export function RuntimeSettingsControl({
  runtime,
  settings,
  applied = true,
  disabled = false,
  showLabels = true,
  saving = false,
  onChange,
}: RuntimeSettingsControlProps) {
  const { t } = useTranslation('chat')
  const fields = useMemo(() => readComposerRuntimeSettingsFields(runtime), [runtime])
  const summary = formatRuntimeSettingsSummary(t, fields, settings)
  const appliedSummary = applied ? summary : t('runtimeSettings.summary.pendingActiveRun', { summary })
  const iconKey = readRuntimeSettingsIconKey(settings)

  if (!runtime?.settingsSchema || fields.length === 0) {
    return null
  }

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              className={cn(
                'h-8 min-w-0 gap-1.5 px-2 text-xs text-muted-foreground transition-colors',
                'hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground',
                !applied && 'text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300',
                !showLabels && 'h-7 w-7 px-0',
                saving && 'opacity-70',
              )}
              aria-label={appliedSummary}
            >
              <RuntimeSettingsIcon iconKey={iconKey} />
              {showLabels && (
                <span className="max-w-40 truncate">
                  {summary}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{appliedSummary}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="w-60">
        {fields.map((field, index) => (
          <RuntimeSettingsFieldGroup
            key={`${field.runtimeKind}:${field.key}`}
            field={field}
            settings={settings}
            showSeparator={index > 0}
            onChange={onChange}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function RuntimeSettingsFieldGroup({
  field,
  settings,
  showSeparator,
  onChange,
}: {
  field: RuntimeSettingsFieldDescriptor
  settings: RuntimeSettings
  showSeparator: boolean
  onChange: (patch: RuntimeSettingsPatch) => void
}) {
  const { t } = useTranslation('chat')
  const currentValue = settings[field.key]

  if (!field.enumOptions?.length) {
    return null
  }

  return (
    <>
      {showSeparator && <DropdownMenuSeparator />}
      <DropdownMenuLabel>{field.label}</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={currentValue === undefined ? '' : String(currentValue)}
        onValueChange={(value) => {
          const selected = field.enumOptions?.find(option => String(option.value) === value)
          if (!selected) {
            return
          }
          onChange({ [field.key]: selected.value })
        }}
      >
        {field.enumOptions.map((option) => {
          const label = labelRuntimeSettingsValue(t, field, option.value)
          return (
            <DropdownMenuRadioItem key={String(option.value)} value={String(option.value)}>
              <RuntimeSettingsEnumIcon fieldKey={field.key} value={String(option.value)} />
              <span>{label}</span>
            </DropdownMenuRadioItem>
          )
        })}
      </DropdownMenuRadioGroup>
    </>
  )
}

function RuntimeSettingsIcon({ iconKey }: { iconKey: 'plan' | 'approval' | 'full-access' }) {
  if (iconKey === 'plan') {
    return <RouteIcon className="size-3.5" aria-hidden="true" />
  }
  if (iconKey === 'approval') {
    return <LockIcon className="size-3.5" aria-hidden="true" />
  }
  return <ShieldCheckIcon className="size-3.5" aria-hidden="true" />
}

function RuntimeSettingsEnumIcon({ fieldKey, value }: { fieldKey: string, value: string }) {
  if (fieldKey === 'interactionMode' && value === 'plan') {
    return <RouteIcon className="size-3.5" aria-hidden="true" />
  }
  if (fieldKey === 'interactionMode' && value === 'default') {
    return <HammerIcon className="size-3.5" aria-hidden="true" />
  }
  if (fieldKey === 'accessMode' && value === 'approval-required') {
    return <LockIcon className="size-3.5" aria-hidden="true" />
  }
  if (fieldKey === 'accessMode' && value === 'full-access') {
    return <ShieldCheckIcon className="size-3.5" aria-hidden="true" />
  }
  if (fieldKey === 'permissionMode' && value === 'plan') {
    return <RouteIcon className="size-3.5" aria-hidden="true" />
  }
  if (fieldKey === 'permissionMode' && (value === 'default' || value === 'acceptEdits')) {
    return <HammerIcon className="size-3.5" aria-hidden="true" />
  }
  if (fieldKey === 'permissionMode' && value === 'bypassPermissions') {
    return <ShieldCheckIcon className="size-3.5" aria-hidden="true" />
  }
  return <HammerIcon className="size-3.5 opacity-0" aria-hidden="true" />
}
