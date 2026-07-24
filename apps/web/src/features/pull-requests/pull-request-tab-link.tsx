import type { ReactNode } from 'react'

import { useBrowserPanelStore } from '~/store/browser-panel'

import type { PullRequestTabTarget } from './pull-request-tab-link-view'
import { PullRequestTabLinkView } from './pull-request-tab-link-view'

interface PullRequestTabLinkProps {
  pullRequest: PullRequestTabTarget
  workId?: string | null
  sessionId?: string | null
  ownerId?: string | null
  className?: string
  title?: string
  children: ReactNode
}

/**
 * Opens a Cradle pull-request tab for a normal click while preserving the
 * GitHub URL for modified clicks and non-browser clients.
 */
export function PullRequestTabLink({
  pullRequest,
  workId,
  sessionId,
  ownerId,
  className,
  title,
  children,
}: PullRequestTabLinkProps) {
  const openPullRequestTab = useBrowserPanelStore(state => state.openPullRequestTab)

  const handleOpen = () => {
    openPullRequestTab({
      owner: pullRequest.owner,
      repo: pullRequest.repo,
      number: pullRequest.number,
      workId: workId ?? undefined,
      sessionId: sessionId ?? undefined,
      title: pullRequest.title,
      ownerId,
    })
  }

  return (
    <PullRequestTabLinkView
      pullRequest={pullRequest}
      className={className}
      title={title ?? pullRequest.title}
      onOpen={handleOpen}
    >
      {children}
    </PullRequestTabLinkView>
  )
}
