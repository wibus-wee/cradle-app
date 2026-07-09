import { ServerLine as ServerIcon } from '@mingcute/react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { getSessionsByIdOptions } from '~/api-gen/@tanstack/react-query.gen'
import { cn } from '~/lib/cn'

import { getRemoteHostId, isRemoteHostExecution } from '../chat/session/session-execution'
import { useRemoteHostsQuery } from './use-remote-host-connection'

interface SessionExecutionChromeProps {
  sessionId: string
  className?: string
}

/**
 * Subtle header badge for sessions that execute on a remote Cradle Server host.
 */
export function SessionExecutionChrome({
  sessionId,
  className,
}: SessionExecutionChromeProps) {
  const { t } = useTranslation('chat')
  const sessionQuery = useQuery({
    ...getSessionsByIdOptions({ path: { id: sessionId } }),
    staleTime: 60_000,
  })
  const hostsQuery = useRemoteHostsQuery(isRemoteHostExecution(sessionQuery.data))
  const hostId = getRemoteHostId(sessionQuery.data)
  if (!hostId) {
    return null
  }

  const host = (hostsQuery.data ?? []).find(candidate => candidate.id === hostId)
  const hostName = host?.displayName || hostId

  return (
    <div
      className={cn(
        'flex h-7 max-w-48 items-center gap-1 rounded-md border border-border/60 px-2',
        'text-[11px] text-muted-foreground',
        className,
      )}
      title={t('execution.badge', { hostName })}
      aria-label={t('execution.badge', { hostName })}
      data-testid="session-execution-badge"
    >
      <ServerIcon className="size-3 shrink-0" aria-hidden="true" />
      <span className="truncate font-medium text-foreground/90">
        {t('execution.badge', { hostName })}
      </span>
    </div>
  )
}
