import { RightSmallLine as ChevronRightIcon } from '@mingcute/react'
import { useRef } from 'react'

import { ProviderIcon } from '~/components/common/provider-icons'
import { Checkbox } from '~/components/ui/checkbox'
import { AgentRuntimeConfigJsonSchema } from '~/features/agent-runtime/agent-config-schema'
import { buildAvatarUrl } from '~/features/agent-runtime/avatar-url'
import type { Agent } from '~/features/agent-runtime/use-agents'
import type { ProviderTargetOption } from '~/features/agent-runtime/use-provider-targets'
import type { RuntimeCatalogItem } from '~/features/agent-runtime/use-runtime-catalog'
import { runtimeCatalogItemUsesCliLaunchConfig } from '~/features/agent-runtime/use-runtime-catalog'
import { cn } from '~/lib/cn'

import { StatusDot } from './agent-status-dot'

interface AgentSidebarRowViewProps {
  agent: Agent
  providerTargets: ProviderTargetOption[]
  runtimeCatalog: RuntimeCatalogItem[]
  active: boolean
  selected: boolean
  onClick: (shiftKey: boolean) => void
  onToggleSelected: (checked: boolean, shiftKey: boolean) => void
}

export function AgentSidebarRowView({
  agent,
  providerTargets,
  runtimeCatalog,
  active,
  selected,
  onClick,
  onToggleSelected,
}: AgentSidebarRowViewProps) {
  const checkboxShiftKeyRef = useRef(false)
  const avatarUrl = agent.avatarUrl || buildAvatarUrl(agent.avatarStyle, agent.avatarSeed)
  const lobeIconSlug = agent.avatarStyle === 'lobehub-icon' ? agent.avatarSeed : null
  const providerTarget = agent.providerTargetId
    ? (providerTargets.find(target => target.id === agent.providerTargetId) ?? null)
    : null
  const runtime = runtimeCatalog.find(item => item.runtimeKind === agent.runtimeKind)
  const runtimeConfig = AgentRuntimeConfigJsonSchema.parse(agent.configJson)
  const usesCliLaunchConfig = runtime
    ? runtimeCatalogItemUsesCliLaunchConfig(runtime)
    : runtimeConfig.cliTui !== null
  const cliTuiLaunch = usesCliLaunchConfig ? runtimeConfig.cliTui : null
  const subtitle = usesCliLaunchConfig
    ? [runtime?.label ?? agent.runtimeKind, cliTuiLaunch?.preset ?? cliTuiLaunch?.executable]
        .filter(Boolean)
        .join(' ·\n')
        || runtime?.label
        || agent.runtimeKind
    : [providerTarget?.name, agent.modelId].filter(Boolean).join(' ·\n') || undefined

  return (
    <div
      data-testid={`agent-sidebar-row-${agent.id}`}
      className={cn(
        'group/sidebar-row flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none',
        'transition-[background-color,opacity,scale] duration-150',
        active
          ? 'bg-accent text-accent-foreground'
          : 'hover:bg-foreground/[0.035] active:bg-foreground/6',
        !agent.enabled && !active && 'opacity-60',
      )}
    >
      <Checkbox
        checked={selected}
        onClickCapture={(event) => {
          checkboxShiftKeyRef.current = event.shiftKey
        }}
        onCheckedChange={(value) => {
          onToggleSelected(!!value, checkboxShiftKeyRef.current)
          checkboxShiftKeyRef.current = false
        }}
      />
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none"
        onClick={event => onClick(event.shiftKey)}
      >
        <div className="size-7 shrink-0 overflow-hidden rounded-lg bg-foreground/5">
          {lobeIconSlug
            ? <ProviderIcon iconSlug={lobeIconSlug} presetId={null} className="size-full p-1" />
            : avatarUrl && (
              <img
                src={avatarUrl}
                alt={agent.name}
                className="size-full object-cover"
                crossOrigin="anonymous"
              />
            )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                'block truncate text-[12.5px] leading-tight',
                active ? 'font-medium text-foreground' : 'text-foreground/90',
              )}
            >
              {agent.name}
            </span>
            <StatusDot tone={agent.enabled ? 'active' : 'muted'} />
          </div>
          {subtitle && (
            <span className="block truncate whitespace-pre text-[10.5px] leading-tight text-muted-foreground/70">
              {subtitle}
            </span>
          )}
        </div>
        <ChevronRightIcon
          className={cn(
            'size-3 shrink-0 !text-muted-foreground/40 transition-[opacity,transform] duration-150',
            active
              ? 'translate-x-0 opacity-100'
              : '-translate-x-1 opacity-0 group-hover/sidebar-row:translate-x-0 group-hover/sidebar-row:opacity-60',
          )}
        />
      </button>
    </div>
  )
}
