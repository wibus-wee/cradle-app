import { DownSmallLine as ChevronDownIcon, RobotLine as BotIcon } from '@mingcute/react'

import type { RuntimeIconDescriptor } from '~/components/common/provider-icons'
import { RuntimeIcon } from '~/components/common/provider-icons'
import { Button } from '~/components/ui/button'
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '~/components/ui/menu'
import { BROWSER_NATIVE_SURFACE_OCCLUSION_PROPS } from '~/features/browser/native-surface-occlusion'
import { cn } from '~/lib/cn'

import type { RuntimeKind } from './types'

export interface RuntimeSelectorOption {
  value: RuntimeKind
  label?: string
  description?: string
  icon?: RuntimeIconDescriptor
  iconKey?: string
  experimental?: boolean
}

export interface RuntimeSelectorProps {
  value: RuntimeKind
  onChange: (kind: RuntimeKind) => void
  options?: RuntimeSelectorOption[]
  disabled?: boolean
  readOnly?: boolean
  appearance?: 'toolbar' | 'settings'
  experimentalLabel?: string
  occludeNativeBrowserSurface?: boolean
}

function getRuntimeLabel(option: RuntimeSelectorOption | undefined, value: RuntimeKind): string {
  return option?.label ?? value
}

function getRuntimeDescription(option: RuntimeSelectorOption): string {
  return option.description ?? option.value
}

function RuntimeOptionIcon({
  className,
  option,
}: {
  className?: string
  option?: RuntimeSelectorOption
}) {
  if (option?.iconKey === 'agents') {
    return <BotIcon className={className} />
  }
  return <RuntimeIcon icon={option?.icon} className={className} />
}

export function RuntimeSelector({
  value,
  onChange,
  options = [],
  disabled,
  readOnly = false,
  appearance = 'toolbar',
  experimentalLabel,
  occludeNativeBrowserSurface = false,
}: RuntimeSelectorProps) {
  const current = options.find(option => option.value === value)
  const currentLabel = getRuntimeLabel(current, value)
  const isSettingsAppearance = appearance === 'settings'

  if (readOnly) {
    return (
      <div
        data-testid="runtime-selector"
        aria-label={currentLabel}
        className="flex h-6 items-center gap-1 px-2 text-xs text-muted-foreground"
      >
        <RuntimeOptionIcon option={current} className="size-3.5 shrink-0" />
        <span className="hidden min-[480px]:inline">{currentLabel}</span>
      </div>
    )
  }

  return (
    <Menu>
      <MenuTrigger
        render={
          isSettingsAppearance
            ? (
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="runtime-selector"
                  disabled={disabled || options.length === 0}
                  className="h-8 w-48 justify-between text-[12.5px]"
                />
              )
            : (
                <Button
                  variant="ghost"
                  size="xs"
                  data-testid="runtime-selector"
                  disabled={disabled || options.length === 0}
                />
              )
        }
      >
        <RuntimeOptionIcon option={current} className="size-3.5 shrink-0" />
        <span className={cn('truncate', !isSettingsAppearance && 'hidden min-[480px]:inline')}>
          {currentLabel}
        </span>
        <ChevronDownIcon className="size-2.5 shrink-0 !text-muted-foreground/50" />
      </MenuTrigger>
      <MenuPopup
        align={isSettingsAppearance ? 'end' : 'start'}
        side={isSettingsAppearance ? 'bottom' : 'top'}
        sideOffset={4}
        className={cn(isSettingsAppearance && 'w-64')}
        {...(occludeNativeBrowserSurface ? BROWSER_NATIVE_SURFACE_OCCLUSION_PROPS : {})}
      >
        {options.map(option => (
          <MenuItem
            key={option.value}
            onClick={() => onChange(option.value)}
            className={cn(value === option.value && 'font-medium')}
          >
            <RuntimeOptionIcon option={option} className="size-3.5" />
            <div className="flex min-w-0 flex-col gap-0.5">
              <div className="flex items-center gap-1.5">
                <span>{getRuntimeLabel(option, option.value)}</span>
                {option.experimental && experimentalLabel && (
                  <span className="inline-flex shrink-0 items-center rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                    {experimentalLabel}
                  </span>
                )}
              </div>
              <span className="text-[11px] text-muted-foreground">
                {getRuntimeDescription(option)}
              </span>
            </div>
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  )
}
