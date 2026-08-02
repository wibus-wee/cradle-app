import { CheckLine as CheckIcon, CopyLine as CopyIcon } from '@mingcute/react'
import { useState } from 'react'

import { toastManager } from '~/components/ui/toast'
import type { KanbanIssue } from '~/features/kanban/types'
import type { Workspace } from '~/features/workspace/types'
import { cn } from '~/lib/cn'

import { formatIssueId } from '../shared/format-issue-id'

/** Linear-style identity kicker rendered above the title — the issue's permanent, copyable key. */
export function IssueKeyBadge({
  issue,
  workspaces,
}: {
  issue: KanbanIssue
  workspaces: Workspace[]
}) {
  const [copied, setCopied] = useState(false)
  const issueKey = formatIssueId(issue, workspaces)

  const handleCopy = () => {
    void navigator.clipboard.writeText(issueKey)
    setCopied(true)
    toastManager.add({ type: 'success', title: 'Copied issue ID', description: issueKey })
    window.setTimeout(setCopied, 1200, false)
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="group mb-1.5 flex items-center gap-1 text-[12px] font-medium tracking-wide text-muted-foreground/80 transition-colors hover:text-foreground"
      title="Copy issue ID"
      data-testid="issue-detail-key-kicker"
    >
      <span className="font-mono tabular-nums">{issueKey}</span>
      {copied
        ? <CheckIcon className="size-3 text-emerald-500" aria-hidden="true" />
        : (
            <CopyIcon
              className={cn('size-3 opacity-0 transition-opacity group-hover:opacity-100')}
              aria-hidden="true"
            />
          )}
    </button>
  )
}
