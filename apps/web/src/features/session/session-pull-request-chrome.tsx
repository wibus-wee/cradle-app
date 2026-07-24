import { useTranslation } from 'react-i18next'

import { toastManager } from '~/components/ui/toast'
import { useBrowserPanelStore } from '~/store/browser-panel'

import { SessionPullRequestChromeView } from './session-pull-request-chrome-view'
import {
  useMarkSessionPullRequestReady,
  useSessionPullRequest,
} from './use-session-pull-request'

interface SessionPullRequestChromeProps {
  sessionId: string
}

export function SessionPullRequestChrome({ sessionId }: SessionPullRequestChromeProps) {
  const { t } = useTranslation('session-pull-request')
  const pullRequestQuery = useSessionPullRequest(sessionId)
  const markReady = useMarkSessionPullRequestReady()
  const openPullRequestTab = useBrowserPanelStore(state => state.openPullRequestTab)
  const pullRequest = pullRequestQuery.data

  if (!pullRequest) {
    return null
  }

  const handleOpenPullRequest = () => {
    openPullRequestTab({
      owner: pullRequest.owner,
      repo: pullRequest.repo,
      number: pullRequest.number,
      sessionId,
      title: pullRequest.title,
    })
  }

  const statusLabel = pullRequest.merged
    ? t('chrome.merged')
    : pullRequest.state === 'closed'
      ? t('chrome.closed')
      : pullRequest.isDraft
        ? t('chrome.draft')
        : t('chrome.ready')

  const handleMarkReady = async () => {
    try {
      await markReady.mutateAsync(sessionId)
      toastManager.add({
        type: 'success',
        title: t('chrome.readySuccessTitle'),
        description: t('chrome.readySuccessDescription', { number: pullRequest.number }),
      })
    }
    catch (error) {
      toastManager.add({
        type: 'error',
        title: t('chrome.errorTitle'),
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return (
    <SessionPullRequestChromeView
      pullRequest={pullRequest}
      statusLabel={statusLabel}
      markReadyLabel={t('chrome.markReady')}
      markingReadyLabel={t('chrome.markingReady')}
      isMarkingReady={markReady.isPending}
      onOpenPullRequest={handleOpenPullRequest}
      onMarkReady={() => void handleMarkReady()}
    />
  )
}
