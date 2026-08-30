import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { getBackgroundActivitiesOptions } from '~/api-gen/@tanstack/react-query.gen'
import { nativeIpc } from '~/lib/electron'

import { selectBackgroundActivityFooterItems } from './background-activity-footer-state'
import { useBackgroundActivityFooterDismissalStore } from './background-activity-footer-store'
import { BackgroundActivityFooterView } from './background-activity-footer-view'

const LOCAL_REFRESH_INTERVAL_MS = 60_000

function openExternalUrl(url: string): void {
  const openExternal = nativeIpc?.native?.openExternal
  if (openExternal) {
    void openExternal(url)
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

export function BackgroundActivityFooter() {
  const { t } = useTranslation('chrome')
  const activities = useQuery({
    ...getBackgroundActivitiesOptions(),
    refetchInterval: LOCAL_REFRESH_INTERVAL_MS,
  })
  const dismissedIdentities = useBackgroundActivityFooterDismissalStore(
    state => state.dismissedIdentities,
  )
  const dismiss = useBackgroundActivityFooterDismissalStore(state => state.dismiss)
  const dismissMany = useBackgroundActivityFooterDismissalStore(state => state.dismissMany)
  const dismissedSet = useMemo(
    () => new Set(dismissedIdentities),
    [dismissedIdentities],
  )
  const items = useMemo(
    () => selectBackgroundActivityFooterItems(activities.data, dismissedSet),
    [activities.data, dismissedSet],
  )

  if (activities.isError || items.length === 0) {
    return null
  }

  return (
    <BackgroundActivityFooterView
      items={items}
      labels={{
        title: t('backgroundActivityFooter.title'),
        open: t('backgroundActivityFooter.open'),
        dismiss: t('backgroundActivityFooter.dismiss'),
        dismissAll: t('backgroundActivityFooter.dismissAll'),
        noticeCount: count => t('backgroundActivityFooter.noticeCount', { count }),
      }}
      onDismiss={dismiss}
      onDismissAll={dismissMany}
      onOpenAction={openExternalUrl}
    />
  )
}
