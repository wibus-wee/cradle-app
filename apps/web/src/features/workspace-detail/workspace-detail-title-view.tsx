import { PencilLine as PencilIcon } from '@mingcute/react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface WorkspaceDetailTitleViewProps {
  value: string
  onSave: (name: string) => void | Promise<void>
}

export function WorkspaceDetailTitleView({
  value,
  onSave,
}: WorkspaceDetailTitleViewProps) {
  const { t } = useTranslation('workspace')
  const [editing, setEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const editStatusRef = useRef<'idle' | 'committing' | 'cancelled'>('idle')

  useEffect(() => {
    if (!editing) {
      return
    }

    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }, [editing])

  const commit = async (): Promise<void> => {
    if (editStatusRef.current !== 'idle') {
      return
    }
    editStatusRef.current = 'committing'
    const nextValue = inputRef.current?.value.trim() ?? ''
    if (nextValue && nextValue !== value) {
      try {
        await onSave(nextValue)
      }
      catch {
        // The owner reports mutation failures; leave edit mode either way.
      }
    }
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        data-testid="workspace-detail-title-input"
        defaultValue={value}
        aria-label={t('detail.title.aria')}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            void commit()
          }
          if (event.key === 'Escape') {
            editStatusRef.current = 'cancelled'
            setEditing(false)
          }
        }}
        className="w-full max-w-80 border-b border-foreground/20 bg-transparent py-px text-lg font-semibold text-foreground outline-none focus:border-foreground/50"
      />
    )
  }

  return (
    <button
      type="button"
      onClick={() => {
        editStatusRef.current = 'idle'
        setEditing(true)
      }}
      data-testid="workspace-detail-title-trigger"
      className="group inline-flex items-center gap-2 text-left"
    >
      <span className="text-lg font-semibold text-foreground">{value}</span>
      <PencilIcon className="size-3 !text-muted-foreground/30 opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  )
}
