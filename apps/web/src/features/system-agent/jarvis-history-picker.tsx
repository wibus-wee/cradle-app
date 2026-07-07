import {
  DotCircleLine as CircleDotIcon,
  HistoryLine as HistoryIcon,
} from '@mingcute/react'
import { useQuery } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

import { getSessionsOptions } from '~/api-gen/@tanstack/react-query.gen'
import type { GetSessionsResponse } from '~/api-gen/types.gen'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { ScrollArea } from '~/components/ui/scroll-area'
import { Spinner } from '~/components/ui/spinner'
import { useNow } from '~/hooks/use-now'
import { cn } from '~/lib/cn'

import { useJarvisUiStore } from './jarvis-ui-store'

const MAX_HISTORY_SESSIONS = 30

function formatHistoryTime(
  timestampSeconds: number | null | undefined,
  nowMs: number,
  t: TFunction<'system-agent'>,
): string {
  if (!timestampSeconds) {
    return t('history.time.unknown')
  }
  const seconds = Math.max(0, Math.floor(nowMs / 1000) - timestampSeconds)
  if (seconds < 60) {
    return t('history.time.justNow')
  }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return t('history.time.minutes', { count: minutes })
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return t('history.time.hours', { count: hours })
  }
  const days = Math.floor(hours / 24)
  if (days < 30) {
    return t('history.time.days', { count: days })
  }
  return t('history.time.months', { count: Math.floor(days / 30) })
}

function isJarvisHistorySession(session: GetSessionsResponse[number]): boolean {
  return session.workspaceId === null
    && session.parentSessionId === null
    && session.sideContextSource === null
    && session.archivedAt === null
}

export function JarvisHistoryPicker({
  onSelectSession,
}: {
  onSelectSession: () => void
}) {
  const { t } = useTranslation('system-agent')
  const [open, setOpen] = React.useState(false)
  const activeSessionId = useJarvisUiStore(s => s.activeSessionId)
  const setActiveSessionId = useJarvisUiStore(s => s.setActiveSessionId)
  const addSession = useJarvisUiStore(s => s.addSession)
  const now = useNow(60_000, open)
  const {
    data: historySessions = [],
    isError,
    isPending,
  } = useQuery({
    ...getSessionsOptions(),
    enabled: open,
    select: sessions => sessions
      .filter(isJarvisHistorySession)
      .slice(0, MAX_HISTORY_SESSIONS),
  })

  const handleSelectSession = (session: GetSessionsResponse[number]) => {
    addSession({
      id: session.id,
      title: session.title?.trim() || 'Jarvis',
      createdAt: session.createdAt * 1000,
    })
    setActiveSessionId(session.id)
    setOpen(false)
    onSelectSession()
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={(
          <button
            type="button"
            data-testid="jarvis-history-button"
            aria-label={t('action.openHistory')}
            className={cn(
              'flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground',
              'transition-colors hover:text-foreground',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              open && 'text-foreground',
            )}
          >
            <HistoryIcon className="size-3" aria-hidden="true" />
          </button>
        )}
      />
      <PopoverContent side="top" align="end" sideOffset={8} className="w-64 gap-0 p-1">
        <div className="px-2 py-1 text-[11px] font-medium text-muted-foreground">
          {t('history.title')}
        </div>
        <ScrollArea className="max-h-64">
          {isPending
            ? (
                <div className="flex min-h-12 items-center gap-2 px-2 text-xs text-muted-foreground">
                  <Spinner className="size-3.5" aria-hidden="true" />
                  <span>{t('history.loading')}</span>
                </div>
              )
            : isError
              ? (
                  <div className="px-2 py-3">
                    <p className="text-xs font-medium text-foreground">{t('history.error.title')}</p>
                    <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{t('history.error.description')}</p>
                  </div>
                )
              : historySessions.length === 0
                ? (
                    <div className="px-2 py-3">
                      <p className="text-xs font-medium text-foreground">{t('history.empty.title')}</p>
                      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{t('history.empty.description')}</p>
                    </div>
                  )
                : (
                    <div className="flex flex-col">
                      {historySessions.map((session) => {
                        const active = session.id === activeSessionId
                        const title = session.title?.trim() || t('history.untitled')
                        const activityAt = session.latestUserMessageAt ?? session.createdAt
                        return (
                          <button
                            key={session.id}
                            type="button"
                            onClick={() => handleSelectSession(session)}
                            className={cn(
                              'group flex min-h-9 w-full flex-col justify-center rounded-md px-2 py-1.5 text-left',
                              'transition-colors duration-150',
                              active
                                ? 'bg-muted text-foreground'
                                : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground',
                            )}
                          >
                            <span className="block w-full truncate text-[12px] font-medium leading-4">{title}</span>
                            <span className="mt-0.5 flex w-full items-center gap-1.5 text-[10px] leading-3 text-muted-foreground">
                              {session.status !== 'idle' && (
                                <CircleDotIcon className="size-2.5 shrink-0" aria-hidden="true" />
                              )}
                              <span className="truncate tabular-nums">{formatHistoryTime(activityAt, now, t)}</span>
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}
