import {
  ComputerLine as ComputerIcon,
} from '@mingcute/react'

import { Button } from '~/components/ui/button'
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from '~/components/ui/menu'

export interface NewChatMachineOption {
  nodeId: string
  label: string
  local: boolean
}

export interface NewChatMachineSelectorViewProps {
  options: NewChatMachineOption[]
  selectedNodeId: string | null
  groupLabel: string
  fallbackLabel: string
  onSelectMachine: (nodeId: string) => void
}

/**
 * Props-only machine picker used by the New Chat composer context bar, shown
 * next to the workspace selector when the selected repository has replicas on
 * several machines.
 */
export function NewChatMachineSelectorView({
  options,
  selectedNodeId,
  groupLabel,
  fallbackLabel,
  onSelectMachine,
}: NewChatMachineSelectorViewProps) {
  const selected = options.find(option => option.nodeId === selectedNodeId) ?? null

  return (
    <Menu>
      <MenuTrigger
        render={<Button variant="ghost" size="xs" className="text-foreground hover:text-foreground" />}
        data-testid="new-chat-machine-selector"
      >
        <ComputerIcon className="size-3 shrink-0" aria-hidden="true" />
        <span className="max-w-24 truncate">{selected?.label ?? fallbackLabel}</span>
      </MenuTrigger>
      <MenuPopup>
        <MenuGroup>
          <MenuGroupLabel>{groupLabel}</MenuGroupLabel>
          <MenuSeparator />
          {options.map(option => (
            <MenuItem
              key={option.nodeId}
              onClick={() => onSelectMachine(option.nodeId)}
              data-testid={`new-chat-machine-option-${option.nodeId}`}
            >
              <ComputerIcon className="size-3" aria-hidden="true" />
              <span className="flex-1">{option.label}</span>
            </MenuItem>
          ))}
        </MenuGroup>
      </MenuPopup>
    </Menu>
  )
}
