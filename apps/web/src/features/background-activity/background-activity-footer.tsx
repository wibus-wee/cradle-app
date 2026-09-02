import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { getBackgroundActivitiesOptions } from '~/api-gen/@tanstack/react-query.gen'
import { nativeIpc } from '~/lib/electron'

import { selectBackgroundActivityFooterItems } from './background-activity-footer-state'
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
  const items = useMemo(
    () => selectBackgroundActivityFooterItems(activities.data),
    [activities.data],
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
      }}
      onOpenAction={openExternalUrl}
    />
  )
}
