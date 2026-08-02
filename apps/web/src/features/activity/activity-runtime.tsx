import { useEffect } from 'react'

import { installActivityAnalyticsSink } from '~/features/product-analytics/activity-analytics-sink'
import { useSplitWorkspaceStore } from '~/features/split-view/store/split-workspace-store'
import { useBrowserPanelStore } from '~/store/browser-panel'

import { installJarvisActivityBridge } from '../system-agent/activity-jarvis-bridge'
import { readJarvisPrefsSnapshot, useJarvisPreferences } from '../system-agent/use-jarvis-preferences'
import { uiActivityBus } from './activity-bus'
import { readUiActivityResolutionInputs } from './resolution-inputs'
import { IDLE_TIMEOUT_MS } from './types'

function tickResolvedEntity(): void {
  const { visible, resolved } = readUiActivityResolutionInputs()
  if (!visible) {
    uiActivityBus.setVisibility(false)
    return
  }
  uiActivityBus.setVisibility(true)
  uiActivityBus.setResolvedEntity(resolved)
}

/**
 * Mounts the UI activity engine and built-in sinks.
 * Engine runs per window; analytics sink skips tearoff internally.
 */
export function ActivityRuntime({
  idleTimeoutMs = IDLE_TIMEOUT_MS,
}: {
  idleTimeoutMs?: number
} = {}) {
  // Keep Jarvis prefs query warm so the ambient bridge can read a snapshot.
  useJarvisPreferences()

  useEffect(() => {
    uiActivityBus.start({ idleTimeoutMs })
    const disposeAnalytics = installActivityAnalyticsSink()
    const disposeJarvis = installJarvisActivityBridge({
      getPrefs: readJarvisPrefsSnapshot,
    })
    tickResolvedEntity()

    const onVisibility = () => {
      tickResolvedEntity()
    }
    document.addEventListener('visibilitychange', onVisibility)

    const unsubBrowser = useBrowserPanelStore.subscribe(() => {
      tickResolvedEntity()
    })
    const unsubSplit = useSplitWorkspaceStore.subscribe(() => {
      tickResolvedEntity()
    })

    const pollId = window.setInterval(() => {
      tickResolvedEntity()
    }, 1000)

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      unsubBrowser()
      unsubSplit()
      window.clearInterval(pollId)
      disposeAnalytics.dispose()
      disposeJarvis.dispose()
      uiActivityBus.stop()
    }
  }, [idleTimeoutMs])

  return null
}
