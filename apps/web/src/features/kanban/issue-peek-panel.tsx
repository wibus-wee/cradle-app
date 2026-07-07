import { CloseLine as XIcon } from '@mingcute/react'
import type { TFunction } from 'i18next'
import { AnimatePresence, m } from 'motion/react'
import { useTranslation } from 'react-i18next'

import { AssetMarkdown } from '~/features/assets/asset-markdown'
import type { KanbanBoardIssue, KanbanStatus } from '~/features/kanban/types'
import { isExternalKanbanIssue } from '~/features/kanban/types'
import { useWorkspaces } from '~/features/workspace/use-workspace'

import { formatIssueId } from './shared/format-issue-id'
import { LabelChip } from './shared/label-chip'
import { PriorityIcon } from './shared/priority-icon'
import { StatusIcon } from './shared/status-icon'
import { useIssue, useStatuses } from './use-kanban'

type IssuePriority = 'none' | 'low' | 'medium' | 'high' | 'urgent'

const priorityLabelKeys: Record<IssuePriority, 'priority.none' | 'priority.low' | 'priority.medium' | 'priority.high' | 'priority.urgent'> = {
  none: 'priority.none',
  low: 'priority.low',
  medium: 'priority.medium',
  high: 'priority.high',
  urgent: 'priority.urgent',
}

interface IssuePeekPanelProps {
  issueId: string | null
  issue?: KanbanBoardIssue | null
  workspaceId: string
  onClose: () => void
  onOpenDetail: (id: string) => void
}

export function IssuePeekPanel({ issueId, issue, workspaceId, onClose, onOpenDetail }: IssuePeekPanelProps) {
  return (
    <AnimatePresence>
      {issueId && (
        <IssuePeekCard
          key="peek"
          issueId={issueId}
          issue={issue}
          workspaceId={workspaceId}
          onClose={onClose}
          onOpenDetail={onOpenDetail}
        />
      )}
    </AnimatePresence>
  )
}

function IssuePeekCard({ issueId, issue: providedIssue, workspaceId, onClose, onOpenDetail }: {
  issueId: string
  issue?: KanbanBoardIssue | null
  workspaceId: string
  onClose: () => void
  onOpenDetail: (id: string) => void
}) {
  const { t } = useTranslation('kanban')
  const { workspaces } = useWorkspaces()
  const isExternal = isExternalKanbanIssue(providedIssue)
  const { data: loadedIssue, isLoading } = useIssue(issueId, !isExternal)
  const { data: statuses = [] } = useStatuses(workspaceId)
  const issue = isExternal ? providedIssue : loadedIssue

  const status = issue?.statusId ? statuses.find(s => s.id === issue.statusId) : undefined

  return (
    <m.div
      initial={{ opacity: 0, y: -8, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.97 }}
      transition={{ duration: 0.15, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="absolute top-2 right-3 z-40 w-120 max-h-180 rounded-xl border border-border bg-card overflow-hidden shadow-xs"
    >
      {/* eslint-disable-next-line style/multiline-ternary */}
      {isLoading || !issue ? (
        <div className="flex items-center justify-center h-24 text-[13px] text-muted-foreground">
          {t('issue.loading')}
        </div>
      ) : (
        <IssuePeekContent
          issue={issue}
          status={status}
          issueId={issueId}
          workspaces={workspaces}
          t={t}
          onClose={onClose}
          onOpenDetail={onOpenDetail}
        />
      )}
    </m.div>
  )
}

function IssuePeekContent({
  issue,
  status,
  issueId,
  workspaces,
  t,
  onClose,
  onOpenDetail,
}: {
  issue: KanbanBoardIssue
  status: KanbanStatus | undefined
  issueId: string
  workspaces: ReturnType<typeof useWorkspaces>['workspaces']
  t: TFunction<'kanban'>
  onClose: () => void
  onOpenDetail: (id: string) => void
}) {
  const labels = issue.labels
  const external = isExternalKanbanIssue(issue)

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-4 pt-2.5">
        <span className="text-[11px] font-mono text-muted-foreground tabular-nums">
          {external ? issue.externalIssue.externalKey : formatIssueId(issue, workspaces)}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="size-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          aria-label={t('issue.closePeek')}
        >
          <XIcon className="size-3.5" />
        </button>
      </div>

      <div className="px-4 py-1">
        <button
          type="button"
          onClick={() => onOpenDetail(issueId)}
          className="text-left text-lg font-medium text-foreground leading-snug hover:text-foreground/80 transition-colors"
        >
          {issue.title}
        </button>
      </div>

      {issue.description && (
        <div className="px-4 py-1 max-h-80 overflow-y-auto mask-[linear-gradient(to_bottom,transparent_0,black_8px,black_calc(100%-12px),transparent_100%)] scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
          <div className="py-1 h-full text-muted-foreground leading-relaxed **:text-sm **:leading-relaxed">
            <AssetMarkdown content={issue.description} />
          </div>
        </div>
      )}

      <div className="px-4 py-2.5 flex flex-col gap-2.5">
        <div className="flex items-center gap-4">
          {status && (
            <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <StatusIcon category={status.category as 'triage' | 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled'} size={13} />
              <span>{status.name}</span>
            </span>
          )}

          {issue.priority && issue.priority !== 'none' && (
            <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <PriorityIcon priority={issue.priority as 'none' | 'low' | 'medium' | 'high' | 'urgent'} size={13} />
              <span>{t(priorityLabelKeys[issue.priority as IssuePriority])}</span>
            </span>
          )}
        </div>

        {labels.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {labels.map(label => <LabelChip key={label} label={label} />)}
          </div>
        )}
      </div>
    </div>
  )
}
