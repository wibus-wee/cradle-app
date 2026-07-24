import { CommandItem, CommandShortcut } from '~/components/ui/command'

import type { CommandAction } from './types'

export interface CommandActionRowProps {
  data: CommandAction
  onSelect: (command: CommandAction) => void
}

export function CommandActionRow({
  data: command,
  onSelect,
}: CommandActionRowProps) {
  return (
    <CommandItem
      value={command.id}
      onSelect={() => onSelect(command)}
      data-testid={`global-search-command-${command.id}`}
    >
      <command.icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px]">{command.label}</span>
        {command.description
          ? (
              <span className="truncate text-[11px] text-muted-foreground/55">
                {command.description}
              </span>
            )
          : null}
      </span>
      {command.shortcut
        ? <CommandShortcut>{command.shortcut}</CommandShortcut>
        : null}
    </CommandItem>
  )
}
