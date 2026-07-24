import type { MouseEvent, ReactNode } from 'react'

import { useBrowserPanelStore } from '~/store/browser-panel'

import type { PullRequestView } from './api/pull-requests'

type PullRequestTabTarget = Pick<PullRequestView, 'owner' | 'repo' | 'number' | 'url' | 'title'>

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

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      event.defaultPrevented
      || event.button !== 0
      || event.metaKey
      || event.ctrlKey
      || event.shiftKey
      || event.altKey
    ) {
      return
    }

    event.preventDefault()
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
    <a
      className={className}
      href={pullRequest.url}
      target="_blank"
      rel="noreferrer"
      title={title ?? pullRequest.title}
      onClick={handleClick}
    >
      {children}
    </a>
  )
}
