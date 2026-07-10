import { PinLine as PinIcon } from '@mingcute/react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

export function SessionRenameInput({
  initialTitle,
  sessionId,
  pinned,
  trailingLabel,
  onCommit,
  onCancel,
}: {
  initialTitle: string
  sessionId: string
  pinned: boolean
  trailingLabel?: string
  onCommit: (nextTitle: string) => Promise<void>
  onCancel: () => void
}) {
  const { t } = useTranslation('workspace')
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    })

    return () => window.cancelAnimationFrame(frame)
  }, [])

  return (
    <fieldset
      className="m-0 flex min-w-0 flex-1 items-center gap-2 border-0 p-0 px-2.5 py-1.5 text-sidebar-foreground/80"
      onClick={event => event.stopPropagation()}
      onKeyDown={event => event.stopPropagation()}
    >
      {pinned
        ? (
            <PinIcon
              className="size-3 shrink-0 !text-primary/60"
              aria-label={t('session.aria.pinned')}
              data-testid={`session-pin-indicator-${sessionId}`}
            />
          )
        : null}
      <input
        ref={renameInputRef}
        aria-label={t('session.action.rename')}
        defaultValue={initialTitle}
        onBlur={(event) => {
          void onCommit(event.currentTarget.value)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            void onCommit(event.currentTarget.value)
          }
          else if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          }
        }}
        data-testid={`session-rename-input-${sessionId}`}
        className="min-w-0 flex-1 bg-transparent text-left text-xs text-sidebar-foreground/90 outline-none placeholder:text-muted-foreground/40"
      />
      {trailingLabel
        ? <span className="shrink-0 text-[11px] text-muted-foreground">{trailingLabel}</span>
        : null}
    </fieldset>
  )
}
