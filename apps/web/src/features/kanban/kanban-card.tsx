import { useSortable } from '@dnd-kit/react/sortable'
import type { HTMLAttributes, MouseEvent, PointerEvent } from 'react'
import { useEffect, useRef, useState } from 'react'

import { useAgents } from '~/features/agent-runtime/use-agents'
import type { KanbanBoardIssue, KanbanMilestone, KanbanStatus } from '~/features/kanban/types'
import { useWorkspaces } from '~/features/workspace/use-workspace'

import { IssueContextMenu } from './issue-context-menu'
import type { KanbanCardRuntimeData, KanbanCardViewProps } from './kanban-card-view'
import { KanbanCardView as CardView } from './kanban-card-view'
import type { ParentIssueRef } from './shared/parent-issue-ref'
import type { ViewConfig } from './use-view-config'

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

export type { KanbanCardRuntimeData } from './kanban-card-view'

type CardChromeProps = Pick<CardProps, 'issue' | 'statuses' | 'parentIssueRef' | 'displayProperties' | 'category' | 'highlighted' | 'selected' | 'runtimeData'> & HTMLAttributes<HTMLDivElement> & Pick<KanbanCardViewProps, 'cardRef' | 'style' | 'pressed' | 'dragging' | 'preview' | 'children'> & {
  onOpenIssue: (id: string) => void
}

function KanbanCardContainer({
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

export const KanbanCard = KanbanCardContainer

function KanbanCardChrome({
  runtimeData,
  ...props
}: CardChromeProps) {
  if (runtimeData) {
    return <CardView {...props} runtimeData={runtimeData} />
  }

  return <KanbanCardChromeFromHooks {...props} />
}

function KanbanCardChromeFromHooks(props: Omit<CardChromeProps, 'runtimeData'>) {
  const { workspaces } = useWorkspaces()
  const { agents } = useAgents()

  return (
    <CardView
      {...props}
      runtimeData={{ workspaces, agents }}
    />
  )
}

export function KanbanCardPreview({
  issue,
  statuses,
  parentIssueRef,
  displayProperties,
  onOpenIssue,
  category,
  highlighted,
  selected,
  runtimeData,
}: CardProps) {
  return (
    <div data-testid={`issue-drag-preview-${issue.id}`}>
      <KanbanCardChrome
        issue={issue}
        statuses={statuses}
        parentIssueRef={parentIssueRef}
        displayProperties={displayProperties}
        onOpenIssue={onOpenIssue}
        category={category}
        highlighted={highlighted}
        selected={selected}
        runtimeData={runtimeData}
        preview
      />
    </div>
  )
}
