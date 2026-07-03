import { DownSmallLine as ChevronDownIcon, RobotLine as BotIcon } from '@mingcute/react'

import { RuntimeIcon } from '~/components/common/provider-icons'
import { Button } from '~/components/ui/button'
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '~/components/ui/menu'
import type { RuntimeKind } from '~/features/agent-runtime/types'
import { BROWSER_NATIVE_SURFACE_OCCLUSION_PROPS } from '~/features/browser/native-surface-occlusion'
import { cn } from '~/lib/cn'

import type { RuntimeKindOption } from './constants'

function getRuntimeLabel(option: RuntimeKindOption | undefined, value: RuntimeKind): string {
  return option?.label ?? value
}

function getRuntimeDescription(option: RuntimeKindOption): string {
  return option.description ?? option.value
}

function RuntimeOptionIcon({
  className,
  option,
}: {
  className?: string
  option?: RuntimeKindOption
}) {
  if (option?.iconKey === 'agents') {
    return <BotIcon className={className} />
  }
  return <RuntimeIcon icon={option?.icon} className={className} />
}

interface RuntimeSelectorProps {
  value: RuntimeKind
  onChange: (kind: RuntimeKind) => void
  readOnly?: boolean
  options?: RuntimeKindOption[]
  disabled?: boolean
  occludeNativeBrowserSurface?: boolean
}

export function RuntimeSelector({
  value,
  onChange,
  readOnly,
  options = [],
  disabled,
  occludeNativeBrowserSurface = false,
}: RuntimeSelectorProps) {
  const current = options.find(o => o.value === value)
  const currentLabel = getRuntimeLabel(current, value)

  if (readOnly) {
    return (
      <Button
        variant="ghost"
        size="xs"
        disabled
        data-testid="runtime-selector"
        aria-label={currentLabel}
        className="disabled:pointer-events-auto disabled:opacity-70"
      >
        <RuntimeOptionIcon option={current} className="size-3.5 shrink-0" />
        <span className="hidden min-[480px]:inline">{currentLabel}</span>
      </Button>
    )
  }

  return (
    <Menu>
      <MenuTrigger
        render={(
          <Button variant="ghost" size="xs" data-testid="runtime-selector" disabled={disabled || options.length === 0} />
        )}
      >
        <RuntimeOptionIcon option={current} className="size-3.5 shrink-0" />
        <span className="hidden min-[480px]:inline">
          {currentLabel}
        </span>
        <ChevronDownIcon className="size-2.5 shrink-0 !text-muted-foreground/50" />
      </MenuTrigger>
      <MenuPopup
        align="start"
        side="top"
        sideOffset={4}
        {...(occludeNativeBrowserSurface ? BROWSER_NATIVE_SURFACE_OCCLUSION_PROPS : {})}
      >
        {options.map(opt => (
          <MenuItem
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={cn(value === opt.value && 'font-medium')}
          >
            <RuntimeOptionIcon option={opt} className="size-3.5" />
            <div className="flex flex-col">
              <span>{getRuntimeLabel(opt, opt.value)}</span>
              <span className="text-[11px] text-muted-foreground">
                {getRuntimeDescription(opt)}
              </span>
            </div>
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  )
}
