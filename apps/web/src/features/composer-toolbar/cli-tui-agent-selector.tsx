import { TerminalBoxLine as SquareTerminalIcon } from '@mingcute/react'

import { Button } from '~/components/ui/button'
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '~/components/ui/menu'
import type { Agent } from '~/features/agent-runtime/use-agents'
import { BROWSER_NATIVE_SURFACE_OCCLUSION_PROPS } from '~/features/browser/native-surface-occlusion'

interface CliTuiAgentSelectorProps {
  agents: Agent[]
  selectedAgentId: string | null
  onSelectAgent: (id: string) => void
  occludeNativeBrowserSurface?: boolean
}

export function CliTuiAgentSelector({
  agents,
  selectedAgentId,
  onSelectAgent,
  occludeNativeBrowserSurface = false,
}: CliTuiAgentSelectorProps) {
  const selectedAgent = agents.find(agent => agent.id === selectedAgentId) ?? null

  return (
    <Menu>
      <MenuTrigger render={<Button variant="ghost" size="xs" data-testid="cli-tui-agent-selector" />}>
        <SquareTerminalIcon className="size-3.5 shrink-0" />
        <span className="max-w-40 truncate">{selectedAgent?.name ?? 'CLI TUI Agent'}</span>
      </MenuTrigger>
      <MenuPopup
        align="start"
        side="top"
        {...(occludeNativeBrowserSurface ? BROWSER_NATIVE_SURFACE_OCCLUSION_PROPS : {})}
      >
        {agents.length === 0
          ? <MenuItem disabled>No CLI TUI agents</MenuItem>
          : agents.map(agent => (
              <MenuItem key={agent.id} onClick={() => onSelectAgent(agent.id)}>
                <SquareTerminalIcon className="size-3.5 shrink-0" />
                <span>{agent.name}</span>
              </MenuItem>
            ))}
      </MenuPopup>
    </Menu>
  )
}
