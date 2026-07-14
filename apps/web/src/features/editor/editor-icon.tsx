import { EditLine as EditIcon } from '@mingcute/react'

import { cn } from '~/lib/cn'
import type { AvailableEditor } from '~/lib/electron'

interface EditorIconProps {
  editor: AvailableEditor
  className?: string
}

export function EditorIcon({ editor, className }: EditorIconProps) {
  if (editor.iconDataUrl) {
    return (
      <img
        src={editor.iconDataUrl}
        alt=""
        aria-hidden="true"
        className={cn('size-4 shrink-0 rounded-[4px] outline outline-1 outline-black/10 dark:outline-white/10', className)}
      />
    )
  }

  return <EditIcon aria-hidden="true" className={cn('size-4 shrink-0 text-muted-foreground', className)} />
}
