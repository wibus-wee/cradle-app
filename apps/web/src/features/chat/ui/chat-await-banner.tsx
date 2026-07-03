import { ExternalLinkLine as ExternalLinkIcon } from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'
import type { LiveAwaitStatus, UnsupportedLiveAwaitStatus } from '~/features/session-await/use-live-await-status'
import { describeLiveAwaitStatus, useLiveAwaitStatus } from '~/features/session-await/use-live-await-status'
import { useLayoutStore } from '~/store/layout'

import type { useSessionAwaitSummary } from '../session/use-session-await'

export function ChatAwaitBanner({
  awaitSummary,
}: {
  awaitSummary: Awaited<ReturnType<typeof useSessionAwaitSummary>['data']>
}) {
  const { t } = useTranslation('chat')
  const primaryAwaitId = typeof awaitSummary?.primaryAwaitId === 'string' ? awaitSummary.primaryAwaitId : null
  const primarySource = typeof awaitSummary?.primarySource === 'string' ? awaitSummary.primarySource : null
  const supportsLiveStatus = primarySource === 'github-ci' || primarySource === 'github-review'
  const { data: rawLiveStatus } = useLiveAwaitStatus(
    awaitSummary?.awaiting && supportsLiveStatus ? primaryAwaitId : null,
    awaitSummary?.awaiting ?? false,
  )

  if (!awaitSummary?.awaiting) {
    return null
  }

  const liveStatus = rawLiveStatus as LiveAwaitStatus | UnsupportedLiveAwaitStatus | undefined
  const liveText = describeLiveAwaitStatus(liveStatus)
  const sourceLabel = primarySource === 'github-ci'
    ? 'GitHub checks'
    : primarySource === 'github-review'
      ? 'GitHub review'
      : null
  const bannerText = liveText && sourceLabel
    ? `${sourceLabel}: ${liveText}`
    : (awaitSummary.reason as string)
      ?? t('await.waitingFor', {
        source: primarySource ?? t('await.source.event'),
      })

  return (
    <div className="mb-2 flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground backdrop-blur-3xl">
      <Spinner className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate">
        {bannerText}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={() => useLayoutStore.getState().openAsideTab('await')}
        className="ml-auto h-5 gap-1 rounded px-1.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <ExternalLinkIcon className="size-3" />
        <span>{t('await.action.view')}</span>
      </Button>
    </div>
  )
}
