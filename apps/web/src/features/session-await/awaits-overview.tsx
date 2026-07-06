import { DotCircleLine as CircleDotIcon, ExternalLinkLine as ExternalLinkIcon } from '@mingcute/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'

import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '~/components/ui/empty'
import { prefetchChatSession } from '~/features/chat/session/chat-session-prefetch'
import { readDesktopAwaits } from '~/features/desktop-tray/api'
import type { DesktopAwaitItem } from '~/features/desktop-tray/types'
import { cn } from '~/lib/cn'
import { openChatSession } from '~/navigation/navigation-commands'

function formatRelativeTime(unixSeconds: number, t: TFunction<'awaits'>): string {
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds)
  if (diff < 60) {
    return t('relative.justNow')
  }
  if (diff < 3600) {
    return t('relative.minute', { count: Math.floor(diff / 60) })
  }
  if (diff < 86400) {
    return t('relative.hour', { count: Math.floor(diff / 3600) })
  }
  return t('relative.day', { count: Math.floor(diff / 86400) })
}

function AwaitRow({ item }: { item: DesktopAwaitItem }) {
  const { t } = useTranslation('awaits')
  const queryClient = useQueryClient()

  const preloadChatSession = () => {
    prefetchChatSession(queryClient, item.sessionId)
  }

  const openChat = () => {
    preloadChatSession()
    openChatSession(item.sessionId)
  }

  return (
    <div className="flex items-center gap-3 rounded-lg bg-muted/30 px-3 py-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-300">
        <CircleDotIcon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{item.title}</span>
          <Badge variant="outline" className="h-5 text-[10px]">{item.source}</Badge>
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="truncate">{item.workspaceName}</span>
          <span className="shrink-0">·</span>
          <span className="shrink-0 tabular-nums">{formatRelativeTime(item.createdAt, t)}</span>
        </div>
        {item.reason ? <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.reason}</p> : null}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={openChat}
        onFocus={preloadChatSession}
        onMouseEnter={preloadChatSession}
        className="shrink-0"
      >
        <ExternalLinkIcon className="size-3.5" />
        {t('action.openChat')}
      </Button>
    </div>
  )
}

export function AwaitsOverview() {
  const { t } = useTranslation('awaits')
  const awaitsQuery = useQuery({
    queryKey: ['desktop', 'awaits'],
    queryFn: readDesktopAwaits,
    refetchInterval: 15_000,
    staleTime: 5_000,
  })
  const awaits = awaitsQuery.data ?? []

  return (
    <div
      className="flex h-full min-w-0 flex-col overflow-hidden bg-background"
      data-testid="awaits-overview"
      data-awaits-ready={awaitsQuery.isSuccess ? 'true' : 'false'}
    >
      <div className="shrink-0 border-b border-border/50 px-5 py-4">
        <h1 className="text-base font-semibold text-foreground">{t('overview.title')}</h1>
        <p className="text-xs text-muted-foreground">{t('overview.description')}</p>
      </div>

      {awaits.length === 0
? (
        <Empty className={cn('border-0', awaitsQuery.isError && 'text-destructive')}>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CircleDotIcon />
            </EmptyMedia>
            <EmptyTitle>{awaitsQuery.isError ? t('error.title') : t('empty.title')}</EmptyTitle>
            <EmptyDescription>
              {awaitsQuery.isError ? t('error.description') : t('empty.description')}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )
: (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="mx-auto flex max-w-4xl flex-col gap-2">
            {awaits.map(item => <AwaitRow key={item.id} item={item} />)}
          </div>
        </div>
      )}
    </div>
  )
}
