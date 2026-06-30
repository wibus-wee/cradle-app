import { DownSmallLine as ChevronDownIcon, RobotLine as BotIcon } from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { getRuntimeIconKey, ProviderIcon } from '~/components/common/provider-icons'
import { Button } from '~/components/ui/button'
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '~/components/ui/menu'
import { BROWSER_NATIVE_SURFACE_OCCLUSION_PROPS } from '~/features/browser/native-surface-occlusion'
import { cn } from '~/lib/cn'
import type { BuiltinRuntimeKind, RuntimeKind } from '~/features/agent-runtime/types'

import type { RuntimeKindOption } from './constants'
import { RUNTIME_KIND_OPTIONS } from './constants'

type CommonKey = keyof typeof import('~/locales/default').default.common
type RuntimeOptionKind = BuiltinRuntimeKind

const runtimeLabelKeys = {
  'standard': 'runtime.standard.label',
  'claude-agent': 'runtime.claudeAgent.label',
  'codex': 'runtime.codex.label',
  'opencode': 'runtime.opencode.label',
  'jar-core': 'runtime.jarCore.label',
  'acp-chat': 'runtime.acpChat.label',
  'cli-tui': 'runtime.cliTui.label',
} satisfies Record<RuntimeOptionKind, CommonKey>

const runtimeDescriptionKeys = {
  'standard': 'runtime.standard.description',
  'claude-agent': 'runtime.claudeAgent.description',
  'codex': 'runtime.codex.description',
  'opencode': 'runtime.opencode.description',
  'jar-core': 'runtime.jarCore.description',
  'acp-chat': 'runtime.acpChat.description',
  'cli-tui': 'runtime.cliTui.description',
} satisfies Record<RuntimeOptionKind, CommonKey>

const runtimeFallbackLabels: Partial<Record<RuntimeKind, string>> = {
  'standard': 'Standard',
  'claude-agent': 'Claude Agent',
  'codex': 'Codex',
  'opencode': 'opencode',
  'cli-tui': 'CLI TUI',
  'jar-core': 'HiJarvis',
  'acp-chat': 'ACP Chat',
}

function isBuiltinRuntimeKind(value: RuntimeKind): value is RuntimeOptionKind {
  return value === 'standard'
    || value === 'claude-agent'
    || value === 'codex'
    || value === 'opencode'
    || value === 'cli-tui'
    || value === 'jar-core'
    || value === 'acp-chat'
}

function getRuntimeLabel(option: RuntimeKindOption | undefined, value: RuntimeKind, t: (key: CommonKey) => string): string {
  if (option?.label) {
    return option.label
  }
  if (isBuiltinRuntimeKind(value)) {
    return t(runtimeLabelKeys[value])
  }
  return runtimeFallbackLabels[value] ?? value
}

function getRuntimeDescription(option: RuntimeKindOption, t: (key: CommonKey) => string): string {
  if (option.description) {
    return option.description
  }
  if (isBuiltinRuntimeKind(option.value)) {
    return t(runtimeDescriptionKeys[option.value])
  }
  return option.value
}

function RuntimeOptionIcon({
  className,
  option,
  value,
}: {
  className?: string
  option?: RuntimeKindOption
  value: RuntimeKind
}) {
  if (option?.iconKey === 'agents') {
    return <BotIcon className={className} />
  }
  return (
    <ProviderIcon
      iconSlug={option?.iconKey ?? getRuntimeIconKey(value)}
      presetId={null}
      className={className}
    />
  )
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
  options = RUNTIME_KIND_OPTIONS,
  disabled,
  occludeNativeBrowserSurface = false,
}: RuntimeSelectorProps) {
  const { t } = useTranslation('common')
  const current = options.find(o => o.value === value) ?? RUNTIME_KIND_OPTIONS.find(o => o.value === value)
  const currentLabel = getRuntimeLabel(current, value, t)

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
        <RuntimeOptionIcon option={current} value={value} className="size-3.5 shrink-0" />
        <span className="hidden min-[480px]:inline">{currentLabel}</span>
      </Button>
    )
  }

  return (
    <Menu>
      <MenuTrigger
        render={(
          <Button variant="ghost" size="xs" data-testid="runtime-selector" disabled={disabled} />
        )}
      >
        <RuntimeOptionIcon option={current} value={value} className="size-3.5 shrink-0" />
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
            <RuntimeOptionIcon option={opt} value={opt.value} className="size-3.5" />
            <div className="flex flex-col">
              <span>{getRuntimeLabel(opt, opt.value, t)}</span>
              <span className="text-[11px] text-muted-foreground">
                {getRuntimeDescription(opt, t)}
              </span>
            </div>
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  )
}
