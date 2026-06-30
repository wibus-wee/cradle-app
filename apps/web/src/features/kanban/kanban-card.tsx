import { useSortable } from '@dnd-kit/react/sortable'
import { CheckLine as CheckIcon, GitBranchLine as GitBranchIcon } from '@mingcute/react'
import type { CSSProperties, HTMLAttributes, MouseEvent, PointerEvent, ReactNode, Ref } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AgentAvatar } from '~/features/agent-runtime/agent-avatar'
import type { Agent } from '~/features/agent-runtime/use-agents'
import { useAgents } from '~/features/agent-runtime/use-agents'
import type { KanbanBoardIssue, KanbanMilestone, KanbanStatus } from '~/features/kanban/types'
import { isExternalKanbanIssue } from '~/features/kanban/types'
import type { Workspace } from '~/features/workspace/types'
import { useWorkspaces } from '~/features/workspace/use-workspace'
import { cn } from '~/lib/cn'

import { IssueContextMenu } from './issue-context-menu'
import { AssigneeAvatar } from './shared/assignee-avatar'
import { formatIssueId } from './shared/format-issue-id'
import { findDelegatedAgent } from './shared/issue-delegation'
import { LabelChip } from './shared/label-chip'
import { ParentIssueLink } from './shared/parent-issue-link'
import type { ParentIssueRef } from './shared/parent-issue-ref'
import { PriorityIcon } from './shared/priority-icon'
import { StatusCategorySchema, StatusIcon } from './shared/status-icon'
import type { ViewConfig } from './use-view-config'

type KanbanKey = keyof typeof import('~/locales/default').default.kanban

interface CardProps {
  issue: KanbanBoardIssue
  index: number
  sortableGroupId?: string
  statuses: KanbanStatus[]
  milestones: KanbanMilestone[]
  parentIssueRef?: ParentIssueRef | null
  displayProperties: ViewConfig['displayProperties']
  onOpenIssue: (id: string) => void
  onSelectionGesture?: (id: string, mode: 'toggle' | 'range') => void
  onHover?: (id: string | null) => void
  category?: string
  highlighted?: boolean
  selected?: boolean
  runtimeData?: KanbanCardRuntimeData
}

export interface KanbanCardRuntimeData {
  workspaces: Workspace[]
  agents: Agent[]
}

type CardChromeProps = Pick<CardProps, 'issue' | 'statuses' | 'milestones' | 'parentIssueRef' | 'displayProperties' | 'category' | 'highlighted' | 'selected' | 'runtimeData'> & HTMLAttributes<HTMLDivElement> & {
  cardRef?: Ref<HTMLDivElement>
  style?: CSSProperties
  pressed?: boolean
  dragging?: boolean
  preview?: boolean
  children?: ReactNode
  onOpenIssue: (id: string) => void
}

const priorityLabelKey: Record<string, KanbanKey> = {
  urgent: 'priority.urgent',
  high: 'priority.high',
  medium: 'priority.medium',
  low: 'priority.low',
  none: 'priority.none',
}

function KanbanCardView({
  issue,
  index,
  sortableGroupId,
  statuses,
  milestones,
  parentIssueRef,
  displayProperties,
  onOpenIssue,
  onSelectionGesture,
  onHover,
  category,
  highlighted,
  selected,
  runtimeData,
}: CardProps) {
  const [pressed, setPressed] = useState(false)
  const openTimerRef = useRef<number | null>(null)
  const sortable = useSortable({
    id: issue.id,
    index,
    group: sortableGroupId,
    data: { issue },
  })

  useEffect(() => {
    return () => {
      const openTimer = openTimerRef.current
      if (openTimer !== null) {
        window.clearTimeout(openTimer)
      }
    }
  }, [])

  const handleOpenIssue = () => {
    onOpenIssue(issue.id)
  }

  const openIssue = (delayMs: number) => {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current)
    }
    if (delayMs <= 0) {
      handleOpenIssue()
      return
    }
    openTimerRef.current = window.setTimeout(() => {
      openTimerRef.current = null
      handleOpenIssue()
    }, delayMs)
  }

  const openCurrentIssueFromCard = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    setPressed(false)

    if (onSelectionGesture && (event.shiftKey || event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      onSelectionGesture?.(issue.id, event.shiftKey ? 'range' : 'toggle')
      return
    }

    openIssue(event.detail > 0 ? 90 : 0)
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button === 0) {
      setPressed(true)
    }
  }

  const releasePress = () => {
    setPressed(false)
  }

  const card = (
    <KanbanCardChrome
      issue={issue}
      statuses={statuses}
      milestones={milestones}
      parentIssueRef={parentIssueRef}
      displayProperties={displayProperties}
      category={category}
      highlighted={highlighted}
      selected={selected}
      runtimeData={runtimeData}
      cardRef={sortable.ref}
      pressed={pressed}
      dragging={sortable.isDragging}
      onOpenIssue={onOpenIssue}
      onPointerDown={handlePointerDown}
      onPointerUp={releasePress}
      onPointerCancel={releasePress}
      onPointerLeave={releasePress}
      onBlur={releasePress}
    >
      <button
        ref={sortable.handleRef}
        type="button"
        aria-label={`${selected ? 'Selected issue' : 'Open issue'} ${issue.title}`}
        aria-pressed={selected ? true : undefined}
        onClick={openCurrentIssueFromCard}
        className="absolute inset-0 z-0 rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
    </KanbanCardChrome>
  )

  return (
    <div
      data-testid={`issue-sortable-${issue.id}`}
      onMouseEnter={() => onHover?.(issue.id)}
      onMouseLeave={() => onHover?.(null)}
    >
      {runtimeData
        ? card
        : (
            <IssueContextMenu issue={issue} statuses={statuses} milestones={milestones} onOpen={handleOpenIssue}>
              {card}
            </IssueContextMenu>
          )}
    </div>
  )
}

export const KanbanCard = KanbanCardView

function KanbanCardChrome({
  runtimeData,
  ...props
}: CardChromeProps) {
  if (runtimeData) {
    return <KanbanCardChromeView {...props} runtimeData={runtimeData} />
  }

  return <KanbanCardChromeFromHooks {...props} />
}

function KanbanCardChromeFromHooks(props: Omit<CardChromeProps, 'runtimeData'>) {
  const { workspaces } = useWorkspaces()
  const { agents } = useAgents()

  return (
    <KanbanCardChromeView
      {...props}
      runtimeData={{ workspaces, agents }}
    />
  )
}

function KanbanCardChromeView({
  issue,
  statuses,
  parentIssueRef,
  displayProperties,
  onOpenIssue,
  category,
  highlighted,
  selected,
  cardRef,
  style,
  pressed,
  dragging,
  preview,
  children,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  onPointerLeave,
  onBlur,
  runtimeData,
  ...cardProps
}: Omit<CardChromeProps, 'runtimeData'> & { runtimeData: KanbanCardRuntimeData }) {
  const { t } = useTranslation('kanban')
  const { workspaces, agents } = runtimeData
  const labels = issue.labels
  const external = isExternalKanbanIssue(issue)
  const issueStatus = statuses.find(status => status.id === issue.statusId)
  const statusCategory = StatusCategorySchema.parse(issueStatus?.category ?? category)
  const delegatedAgent = findDelegatedAgent(issue, agents)
  const showAssigneeAvatar = displayProperties.assignee && issue.assigneeId
  const showAgentAvatar = displayProperties.agentIndicator && delegatedAgent

  return (
    <div
      {...cardProps}
      ref={cardRef}
      style={style}
      data-pressed={pressed ? 'true' : undefined}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={onPointerLeave}
      onBlur={onBlur}
      data-testid={`issue-card-${issue.id}`}
      className={cn(
        'group/card relative w-full bg-card rounded-md px-3.5 py-3 pb-2.5 cursor-pointer border border-border/80 text-left',
        'flex flex-col gap-1',
        'shadow-[var(--shadow-xs)]',
        'transition-[scale,transform,box-shadow,border-color,background-color] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]',
        'hover:shadow-[var(--shadow-sm)] hover:bg-card',
        'active:scale-[0.985] data-[pressed=true]:scale-[0.985] data-[pressed=true]:border-primary/40 data-[pressed=true]:shadow-[var(--shadow-xs)]',
        !highlighted && !selected && !pressed && 'hover:border-border',
        external && 'border-dashed border-border bg-muted/20',
        selected && 'border-primary/60 bg-primary/5 shadow-[var(--shadow-sm)]',
        dragging && 'opacity-50',
        preview && 'pointer-events-none',
      )}
    >
      {children}

      <span className="pointer-events-none relative z-10 flex justify-between">
        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              'pointer-events-none flex size-4 items-center justify-center rounded border text-primary',
              'transition-[opacity,background-color,border-color,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]',
              selected ? 'border-primary bg-primary/10 opacity-100' : 'border-border bg-background opacity-0 group-hover/card:opacity-100',
            )}
            aria-hidden="true"
          >
            <span className="t-icon-swap size-3" data-state={selected ? 'b' : 'a'}>
              <span className="t-icon size-3" data-icon="a" />
              <CheckIcon className="t-icon size-3" data-icon="b" />
            </span>
          </span>

          {displayProperties.id && (
            <span className="text-[10.5px] text-muted-foreground tabular-nums">
              {external ? issue.externalIssue.externalKey : formatIssueId(issue, workspaces)}
            </span>
          )}
          {external && (
            <span className="inline-flex items-center gap-1 rounded border border-border bg-background px-1 py-0.5 text-[10px] font-medium text-muted-foreground">
              <GitBranchIcon className="size-2.5" aria-hidden="true" />
              GitHub
            </span>
          )}
        </span>

        {(displayProperties.assignee || displayProperties.agentIndicator) && (
          <span className="flex min-w-[26px] justify-end">
            {showAssigneeAvatar || showAgentAvatar
              ? (
                  <span className="flex items-center -space-x-1.5 *:ring-2 *:ring-card">
                    {showAssigneeAvatar && <AssigneeAvatar name={issue.assigneeId} size={18} />}
                    {showAgentAvatar && (
                      <AgentAvatar
                        name={delegatedAgent.name}
                        avatarUrl={delegatedAgent.avatarUrl}
                        avatarStyle={delegatedAgent.avatarStyle}
                        avatarSeed={delegatedAgent.avatarSeed}
                        size={18}
                      />
                    )}
                  </span>
                )
              : displayProperties.assignee
                ? <span className="size-3.5 shrink-0 rounded-full border border-dashed border-muted-foreground" />
                : null}
          </span>
        )}
      </span>

      {parentIssueRef && (
        <span className="relative z-10 flex items-center">
          <ParentIssueLink
            parentIssueKey={parentIssueRef.key}
            variant="card"
            onOpen={() => onOpenIssue(parentIssueRef.id)}
          />
        </span>
      )}

      <span className="pointer-events-none relative z-10 flex items-start gap-2">
        {displayProperties.status && (
          <span className="mt-1 shrink-0">
            <StatusIcon category={statusCategory} size={16} />
          </span>
        )}
        <span className="text-[13px] font-medium text-foreground leading-snug tracking-tight text-balance">
          {issue.title}
        </span>
      </span>

      <span className="pointer-events-none relative z-10 flex items-center gap-2 mt-2.5 text-muted-foreground">
        {displayProperties.priority && issue.priority !== 'none' && (
          <span className="flex items-center gap-1 text-[11px]">
            <PriorityIcon priority={issue.priority as 'none' | 'low' | 'medium' | 'high' | 'urgent'} size={13} />
            <span>{t(priorityLabelKey[issue.priority] ?? 'priority.none')}</span>
          </span>
        )}

        {displayProperties.labels && labels.length > 0 && (
          <span className="flex items-center gap-1">
            {labels.slice(0, 2).map(l => <LabelChip key={l} label={l} />)}
            {labels.length > 2 && (
              <span className="text-[11px] text-muted-foreground tabular-nums">
                +
                {labels.length - 2}
              </span>
            )}
          </span>
        )}
      </span>
    </div>
  )
}

export function KanbanCardPreview(props: CardProps) {
  return (
    <div data-testid={`issue-drag-preview-${props.issue.id}`}>
      <KanbanCardChrome
        {...props}
        preview
      />
    </div>
  )
}
