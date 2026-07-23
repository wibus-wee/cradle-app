import {
  DotCircleLine as CircleDotIcon,
  ExternalLinkLine as ExternalLinkIcon,
} from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import type { DesktopAwaitItem } from '~/features/desktop-tray/types'

export interface AwaitRowViewProps {
  item: DesktopAwaitItem
  onOpenChat: (sessionId: string) => void
  onPreloadChat: (sessionId: string) => void
  now?: number
}

export function AwaitRowView({
  item,
  onOpenChat,
  onPreloadChat,
  now = Date.now(),
}: AwaitRowViewProps) {
  const { t } = useTranslation('awaits')
  const elapsedSeconds = Math.max(0, Math.floor(now / 1000) - item.createdAt)

  const relativeTime = elapsedSeconds < 60
    ? t('relative.justNow')
    : elapsedSeconds < 3_600
      ? t('relative.minute', { count: Math.floor(elapsedSeconds / 60) })
      : elapsedSeconds < 86_400
        ? t('relative.hour', { count: Math.floor(elapsedSeconds / 3_600) })
        : t('relative.day', { count: Math.floor(elapsedSeconds / 86_400) })

  return (
    <div className="flex items-center gap-3 rounded-lg bg-muted/30 px-3 py-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-300">
        <CircleDotIcon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-medium text-foreground">{item.title}</span>
          <Badge variant="outline" className="h-5 text-[10px]">{item.source}</Badge>
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="truncate">{item.workspaceName}</span>
          <span className="shrink-0">·</span>
          <span className="shrink-0 tabular-nums">{relativeTime}</span>
        </div>
        {item.reason
          ? <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.reason}</p>
          : null}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onOpenChat(item.sessionId)}
        onFocus={() => onPreloadChat(item.sessionId)}
        onMouseEnter={() => onPreloadChat(item.sessionId)}
        aria-label={t('action.openChat')}
        className="size-8 shrink-0 px-0 sm:h-8 sm:w-auto sm:px-3"
      >
        <ExternalLinkIcon className="size-3.5" />
        <span className="hidden sm:inline">{t('action.openChat')}</span>
      </Button>
    </div>
  )
}
