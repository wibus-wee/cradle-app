import {
  ArrowLeftLine as ArrowLeftIcon,
  ArrowRightLine as ArrowRightIcon,
} from '@mingcute/react'
import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { router } from '~/router'

interface HistoryPosition {
  index: number
  furthestIndex: number
}

let historyPosition: HistoryPosition | null = null

function subscribeToHistory(onStoreChange: () => void): () => void {
  return router.history.subscribe(({ action, location }) => {
    const index = location.state.__TSR_index
    const currentPosition = getHistoryPosition()
    const furthestIndex = action.type === 'PUSH'
      ? index
      : Math.max(currentPosition.furthestIndex, index)

    historyPosition = { index, furthestIndex }
    onStoreChange()
  })
}

function getHistoryPosition(): HistoryPosition {
  if (!historyPosition) {
    const index = router.history.location.state.__TSR_index
    historyPosition = { index, furthestIndex: index }
  }
  return historyPosition
}

export function AppNavigationControls() {
  const { t } = useTranslation('chrome')
  const { index, furthestIndex } = useSyncExternalStore(
    subscribeToHistory,
    getHistoryPosition,
    getHistoryPosition,
  )
  const canGoBack = index > 0
  const canGoForward = index < furthestIndex

  return (
    <div
      className="flex shrink-0 items-center"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="text-muted-foreground disabled:opacity-30"
        disabled={!canGoBack}
        onClick={() => router.history.back()}
        aria-label={t('header.action.goBack')}
        title={t('header.action.goBack')}
        data-testid="app-header-back"
      >
        <ArrowLeftIcon aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="text-muted-foreground disabled:opacity-30"
        disabled={!canGoForward}
        onClick={() => router.history.forward()}
        aria-label={t('header.action.goForward')}
        title={t('header.action.goForward')}
        data-testid="app-header-forward"
      >
        <ArrowRightIcon aria-hidden="true" />
      </Button>
    </div>
  )
}
