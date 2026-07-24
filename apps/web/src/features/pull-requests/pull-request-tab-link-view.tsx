import type { MouseEvent, ReactNode } from 'react'

import type { PullRequestView } from './api/pull-requests'

export type PullRequestTabTarget = Pick<PullRequestView, 'owner' | 'repo' | 'number' | 'url' | 'title'>

interface PullRequestTabLinkViewProps {
  pullRequest: PullRequestTabTarget
  className?: string
  title?: string
  children: ReactNode
  onOpen?: () => void
}

export function PullRequestTabLinkView({
  pullRequest,
  className,
  title,
  children,
  onOpen,
}: PullRequestTabLinkViewProps) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      !onOpen
      || event.defaultPrevented
      || event.button !== 0
      || event.metaKey
      || event.ctrlKey
      || event.shiftKey
      || event.altKey
    ) {
      return
    }

    event.preventDefault()
    onOpen()
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
