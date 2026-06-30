import { DownSmallLine as ChevronDownIcon, RobotLine as BotIcon } from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '~/components/ui/menu'
import { AgentAvatar } from '~/features/agent-runtime/agent-avatar'
import type { Agent } from '~/features/agent-runtime/use-agents'
import { BROWSER_NATIVE_SURFACE_OCCLUSION_PROPS } from '~/features/browser/native-surface-occlusion'
import { cn } from '~/lib/cn'

import type { RuntimeKindOption } from './constants'

interface AgentSelectorProps {
  agents: Agent[]
  selectedAgentId: string | null
  runtimeOptions: RuntimeKindOption[]
  onSelectAgent: (id: string) => void
  occludeNativeBrowserSurface?: boolean
}

function runtimeLabel(runtimeOptions: RuntimeKindOption[], runtimeKind: Agent['runtimeKind']): string {
  return runtimeOptions.find(option => option.value === runtimeKind)?.label ?? runtimeKind
}

export function AgentSelector({
  agents,
  selectedAgentId,
  runtimeOptions,
  onSelectAgent,
  occludeNativeBrowserSurface = false,
}: AgentSelectorProps) {
  const { t } = useTranslation('common')
  const selectedAgent = agents.find(agent => agent.id === selectedAgentId) ?? null

  return (
    <Menu>
      <MenuTrigger
        render={(
          <Button
            variant="ghost"
            size="xs"
            data-testid="agent-selector"
            data-selected-agent-id={selectedAgentId ?? ''}
            className="min-w-0 max-w-full shrink"
          />
        )}
      >
        {selectedAgent
          ? (
              <AgentAvatar
                name={selectedAgent.name}
                avatarUrl={selectedAgent.avatarUrl}
                avatarStyle={selectedAgent.avatarStyle}
                avatarSeed={selectedAgent.avatarSeed}
                size={14}
                className="shrink-0"
              />
            )
          : <BotIcon className="size-3.5 shrink-0 !text-muted-foreground/70" />}
        <span className="min-w-0 max-w-40 truncate">
          {selectedAgent?.name ?? t('agent.selector.label')}
        </span>
        <ChevronDownIcon className="size-2.5 shrink-0 !text-muted-foreground/50" />
      </MenuTrigger>
      <MenuPopup
        align="start"
        side="top"
        sideOffset={4}
        className="w-64"
        {...(occludeNativeBrowserSurface ? BROWSER_NATIVE_SURFACE_OCCLUSION_PROPS : {})}
      >
        {agents.length === 0
          ? <MenuItem disabled>{t('agent.empty')}</MenuItem>
          : agents.map(agent => (
              <MenuItem
                key={agent.id}
                onClick={() => onSelectAgent(agent.id)}
                className={cn(selectedAgentId === agent.id && 'font-medium')}
              >
                <AgentAvatar
                  name={agent.name}
                  avatarUrl={agent.avatarUrl}
                  avatarStyle={agent.avatarStyle}
                  avatarSeed={agent.avatarSeed}
                  size={16}
                />
                <div className="flex min-w-0 flex-col">
                  <span className="truncate">{agent.name}</span>
                  <span className="truncate text-[11px] text-muted-foreground">
                    {agent.description ?? runtimeLabel(runtimeOptions, agent.runtimeKind)}
                  </span>
                </div>
              </MenuItem>
            ))}
      </MenuPopup>
    </Menu>
  )
}
