// Compact Composer control for Cradle-owned runtime access and interaction settings.
import {
  HammerLine as HammerIcon,
  LockLine as LockIcon,
  RouteLine as RouteIcon,
  SafeShieldLine as ShieldCheckIcon,
} from '@mingcute/react'
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
import { cn } from '~/lib/cn'

import type { ChatRuntimeAccessMode, ChatRuntimeInteractionMode, ChatRuntimeSettings } from '../commands/chat-response-command'

interface RuntimeSettingsControlProps {
  settings: ChatRuntimeSettings
  applied?: boolean
  disabled?: boolean
  showLabels?: boolean
  showInteractionLabel?: boolean
  saving?: boolean
  onChange: (patch: Partial<ChatRuntimeSettings>) => void
}

export function RuntimeSettingsControl({
  settings,
  applied = true,
  disabled = false,
  showLabels = true,
  showInteractionLabel = true,
  saving = false,
  onChange,
}: RuntimeSettingsControlProps) {
  const { t } = useTranslation('chat')
  const accessLabel = settings.accessMode === 'full-access'
    ? t('runtimeSettings.access.fullAccess')
    : t('runtimeSettings.access.approvalRequired')
  const interactionLabel = settings.interactionMode === 'plan'
    ? t('runtimeSettings.interaction.plan')
    : t('runtimeSettings.interaction.default')
  const summary = t('runtimeSettings.summary', {
    access: accessLabel,
    interaction: interactionLabel,
  })
  const appliedSummary = applied ? summary : t('runtimeSettings.summary.pendingActiveRun', { summary })

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
              {settings.accessMode === 'full-access'
                ? <ShieldCheckIcon className="size-3.5" aria-hidden="true" />
                : <LockIcon className="size-3.5" aria-hidden="true" />}
              {showLabels && (
                <>
                  <span className="hidden max-w-32 truncate sm:inline">
                    {accessLabel}
                  </span>
                  {showInteractionLabel && (
                    <>
                      <span className="hidden text-muted-foreground/60 sm:inline" aria-hidden="true">/</span>
                      <span className="hidden max-w-24 truncate sm:inline">
                        {interactionLabel}
                      </span>
                    </>
                  )}
                </>
              )}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{appliedSummary}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>{t('runtimeSettings.access.label')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={settings.accessMode}
          onValueChange={value => onChange({ accessMode: value as ChatRuntimeAccessMode })}
        >
          <DropdownMenuRadioItem value="approval-required">
            <LockIcon className="size-3.5" aria-hidden="true" />
            <span>{t('runtimeSettings.access.approvalRequired')}</span>
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="full-access">
            <ShieldCheckIcon className="size-3.5" aria-hidden="true" />
            <span>{t('runtimeSettings.access.fullAccess')}</span>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t('runtimeSettings.interaction.label')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={settings.interactionMode}
          onValueChange={value => onChange({ interactionMode: value as ChatRuntimeInteractionMode })}
        >
          <DropdownMenuRadioItem value="default">
            <HammerIcon className="size-3.5" aria-hidden="true" />
            <span>{t('runtimeSettings.interaction.default')}</span>
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="plan">
            <RouteIcon className="size-3.5" aria-hidden="true" />
            <span>{t('runtimeSettings.interaction.plan')}</span>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
