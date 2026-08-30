import { ClipboardLine as NotesIcon } from '@mingcute/react'

import { cn } from '~/lib/cn'

export type SessionNotesStatus = 'saved' | 'unsaved' | 'saving' | 'error'

export interface SessionNotesViewProps {
  label: string
  value: string
  placeholder: string
  status: SessionNotesStatus
  statusLabels: Record<SessionNotesStatus, string>
  onChange: (value: string) => void
}

const statusColor: Record<SessionNotesStatus, string> = {
  saved: 'text-emerald-600 dark:text-emerald-400',
  unsaved: 'text-muted-foreground',
  saving: 'text-muted-foreground',
  error: 'text-destructive',
}

/** Props-only notes editor with explicit autosave state for the session environment. */
export function SessionNotesView({
  label,
  value,
  placeholder,
  status,
  statusLabels,
  onChange,
}: SessionNotesViewProps) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-1.5">
        <NotesIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
        <span className="text-[11px] font-semibold text-foreground/80">{label}</span>
        <span
          className={cn('ml-auto text-[10px]', statusColor[status])}
          role="status"
          aria-live="polite"
        >
          {statusLabels[status]}
        </span>
      </div>
      <textarea
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="min-h-28 w-full resize-y rounded-lg bg-fill/35 px-2.5 py-2 text-[12px] leading-5 outline-none shadow-[0_0_0_1px_rgba(127,127,127,0.14)] transition-[box-shadow] focus:shadow-[0_0_0_1px_var(--color-ring)]"
      />
    </section>
  )
}
