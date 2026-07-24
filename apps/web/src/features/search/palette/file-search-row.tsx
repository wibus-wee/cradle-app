import { FileLine } from '@mingcute/react'

import { CommandItem } from '~/components/ui/command'

import type { GlobalSearchFile } from './types'

export interface FileSearchRowProps {
  data: GlobalSearchFile
  onSelect: (filePath: string) => void
}

export function FileSearchRow({ data: file, onSelect }: FileSearchRowProps) {
  const directory = file.path.endsWith(file.name)
    ? file.path.slice(0, file.path.length - file.name.length).replace(/\/$/, '')
    : ''

  return (
    <CommandItem
      value={`file-${file.path}`}
      onSelect={() => onSelect(file.path)}
      className="py-0.5"
      data-testid={`global-search-file-result-${file.path}`}
    >
      <FileLine className="size-4 shrink-0 text-muted-foreground/65" />
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span className="truncate text-[13px]">{file.name}</span>
        {directory
          ? (
              <span className="truncate font-mono text-[11px] text-muted-foreground/40">
                {directory}
              </span>
            )
          : null}
      </span>
    </CommandItem>
  )
}
