import { DownSmallLine as ChevronDownIcon, RobotLine as RobotIcon } from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '~/components/ui/menu'
import type { AcpInstalledAgent } from '~/features/agent-runtimes/use-acp-registry'
import { BROWSER_NATIVE_SURFACE_OCCLUSION_PROPS } from '~/features/browser/native-surface-occlusion'
import { cn } from '~/lib/cn'

interface AcpAgentSelectorProps {
  agents: AcpInstalledAgent[]
  selectedAgentId: string | null
  onSelectAgent: (id: string) => void
  occludeNativeBrowserSurface?: boolean
}

/** Selects an installed ACP agent directly, without requiring a Cradle Agent wrapper. */
export function AcpAgentSelector({
  agents,
  selectedAgentId,
  onSelectAgent,
  occludeNativeBrowserSurface = false,
}: AcpAgentSelectorProps) {
  const { t } = useTranslation('common')
  const selectedAgent = agents.find(agent => agent.id === selectedAgentId) ?? null

  return (
    <Menu>
      <MenuTrigger
        render={(
          <Button
            variant="ghost"
            size="xs"
            data-testid="acp-agent-selector"
            data-selected-acp-agent-id={selectedAgentId ?? ''}
            className="min-w-0 max-w-full shrink"
          />
        )}
      >
        <RobotIcon className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
        <span className="min-w-0 max-w-40 truncate">
          {selectedAgent?.name ?? t('acpAgent.selector.label')}
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
          ? <MenuItem disabled>{t('acpAgent.empty')}</MenuItem>
          : agents.map(agent => (
              <MenuItem
                key={agent.id}
                onClick={() => onSelectAgent(agent.id)}
                className={cn(selectedAgentId === agent.id && 'font-medium')}
              >
                <RobotIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="flex min-w-0 flex-col">
                  <span className="truncate">{agent.name}</span>
                  <span className="truncate text-[11px] text-muted-foreground">
                    {agent.version ?? agent.id}
                  </span>
                </div>
              </MenuItem>
            ))}
      </MenuPopup>
    </Menu>
  )
}
