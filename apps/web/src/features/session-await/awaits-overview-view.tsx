import { DotCircleLine as CircleDotIcon, Refresh2Line as RetryIcon } from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '~/components/ui/empty'
import type { DesktopAwaitItem } from '~/features/desktop-tray/types'
import { cn } from '~/lib/cn'

import { AwaitRowView } from './await-row-view'

export interface AwaitsOverviewViewProps {
  awaits: readonly DesktopAwaitItem[]
  isReady: boolean
  hasError: boolean
  retrying?: boolean
  onRetry: () => void
  onOpenChat: (sessionId: string) => void
  onPreloadChat: (sessionId: string) => void
  now?: number
}

export function AwaitsOverviewView({
  awaits,
  isReady,
  hasError,
  retrying = false,
  onRetry,
  onOpenChat,
  onPreloadChat,
  now,
}: AwaitsOverviewViewProps) {
  const { t } = useTranslation('awaits')

  return (
    <div
      className="flex h-full min-w-0 flex-col overflow-hidden bg-background"
      data-testid="awaits-overview"
      data-awaits-ready={isReady ? 'true' : 'false'}
    >
      <div className="shrink-0 border-b border-border/50 px-5 py-4">
        <h1 className="text-base font-semibold text-foreground">{t('overview.title')}</h1>
        <p className="text-xs text-muted-foreground">{t('overview.description')}</p>
      </div>

      {awaits.length === 0
        ? (
            <Empty className={cn('border-0', hasError && 'text-destructive')}>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CircleDotIcon />
                </EmptyMedia>
                <EmptyTitle>{hasError ? t('error.title') : t('empty.title')}</EmptyTitle>
                <EmptyDescription>
                  {hasError ? t('error.description') : t('empty.description')}
                </EmptyDescription>
              </EmptyHeader>
              {hasError && (
                <Button type="button" variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
                  <RetryIcon className={cn('size-3.5', retrying && 'animate-spin')} aria-hidden="true" />
                  {t('error.retry')}
                </Button>
              )}
            </Empty>
          )
        : (
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <div className="mx-auto flex max-w-4xl flex-col gap-2">
                {awaits.map(item => (
                  <AwaitRowView
                    key={item.id}
                    item={item}
                    onOpenChat={onOpenChat}
                    onPreloadChat={onPreloadChat}
                    now={now}
                  />
                ))}
              </div>
            </div>
          )}
    </div>
  )
}
