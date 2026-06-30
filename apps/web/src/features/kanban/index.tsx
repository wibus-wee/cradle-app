import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BetaNotice } from '~/components/common/beta-notice'
import type {
  KanbanBoardIssue,
  KanbanIssue,
  KanbanMilestone,
  KanbanStatus,
} from '~/features/kanban/types'
import { isExternalKanbanIssue } from '~/features/kanban/types'
import type { Workspace } from '~/features/workspace/types'
import { useWorkspaces } from '~/features/workspace/use-workspace'

import { CreateIssueDialog } from './create-issue-dialog'
import { IssueDetail } from './issue-detail'
import { IssuePeekPanel } from './issue-peek-panel'
import { KanbanBoard } from './kanban-board'
import type { KanbanContextIssue } from './kanban-context'
import {
  clearKanbanAttentionSnapshot,
  updateKanbanAttentionSnapshot,
} from './kanban-context'
import { KanbanList } from './kanban-list'
import type { IssueSelectionMode } from './kanban-selection'
import {
  addIssueSelectionRange,
  orderedIssuesForKanbanView,
  toggleIssueSelection,
} from './kanban-selection'
import { KanbanSelectionBar } from './kanban-selection-bar'
import { KanbanToolbar } from './kanban-toolbar'
import { formatIssueId } from './shared/format-issue-id'
import type { ParentIssueRef } from './shared/parent-issue-ref'
import {
  useBoardIssues,
  useMilestones,
  useMoveExternalIssue,
  useMoveIssue,
  useStatuses,
} from './use-kanban'
import type { FilterState } from './use-view-config'
import { useViewConfig } from './use-view-config'

interface KanbanViewProps {
  boardId: string
  workspaceId: string
  selectedIssueId?: string | null
  initialMilestoneId?: string | null
  onSelectIssue?: (id: string | null) => void
  onOpenMilestone?: (id: string) => void
}

function toContextIssue(
  issue: KanbanBoardIssue | null | undefined,
  workspaces: Workspace[],
): KanbanContextIssue | null {
  if (!issue) {
    return null
  }

  return {
    id: issue.id,
    label: isExternalKanbanIssue(issue)
      ? issue.externalIssue.externalKey
      : formatIssueId(issue, workspaces),
    title: issue.title,
  }
}

function summarizeKanbanFilter(
  filter: FilterState,
  statuses: KanbanStatus[],
  milestones: KanbanMilestone[],
): string | null {
  const parts: string[] = []

  if (filter.statusIds?.length) {
    const statusNames = filter.statusIds.map((statusId) => {
      const status = statuses.find(candidate => candidate.id === statusId)
      return status?.name ?? statusId
    })
    parts.push(`statuses: ${statusNames.join(', ')}`)
  }

  if (filter.priorities?.length) {
    parts.push(`priorities: ${filter.priorities.join(', ')}`)
  }

  if (filter.labels?.length) {
    parts.push(`labels: ${filter.labels.join(', ')}`)
  }

  if (filter.milestoneId) {
    const milestone = milestones.find(candidate => candidate.id === filter.milestoneId)
    parts.push(`milestone: ${milestone?.title ?? filter.milestoneId}`)
  }

  if (filter.isDelegated === true) {
    parts.push('delegated issues only')
  }

  if (filter.isDelegated === false) {
    parts.push('non-delegated issues only')
  }

  return parts.length > 0 ? parts.join('; ') : null
}

export function KanbanView({
  boardId: _boardId,
  workspaceId,
  selectedIssueId,
  initialMilestoneId,
  onSelectIssue,
  onOpenMilestone,
}: KanbanViewProps) {
  const { t } = useTranslation('kanban')
  const boardId = _boardId
  const { config, setConfig, filter, setFilter, resetFilter } = useViewConfig(workspaceId)
  const { workspaces } = useWorkspaces()
  const [searchQuery, setSearchQuery] = useState('')
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [createDefaultStatusId, setCreateDefaultStatusId] = useState<string | undefined>()
  const [selectedIssueIds, setSelectedIssueIds] = useState<Set<string>>(() => new Set())
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null)

  // Peek state
  const [peekIssueId, setPeekIssueId] = useState<string | null>(null)
  const [focusedIndex, setFocusedIndex] = useState<number>(-1)
  const [hoveredIssueId, setHoveredIssueId] = useState<string | null>(null)
  const spaceDownTimeRef = useRef<number>(0)
  const peekWasOpenRef = useRef(false)
  const visibleIssuesRef = useRef<KanbanBoardIssue[]>([])
  // Refs for keyboard handler (avoid stale closures + listener re-registration)
  const peekIssueIdRef = useRef<string | null>(null)
  const focusedIndexRef = useRef<number>(-1)
  const hoveredIssueIdRef = useRef<string | null>(null)
  const selectedIssueIdRef = useRef<string | null | undefined>(undefined)
  const selectedIssueIdsRef = useRef<Set<string>>(selectedIssueIds)
  const selectionAnchorIdRef = useRef<string | null>(selectionAnchorId)
  const onSelectIssueRef = useRef(onSelectIssue)

  useEffect(() => {
    peekIssueIdRef.current = peekIssueId
  }, [peekIssueId])
  useEffect(() => {
    focusedIndexRef.current = focusedIndex
  }, [focusedIndex])
  useEffect(() => {
    hoveredIssueIdRef.current = hoveredIssueId
  }, [hoveredIssueId])
  useEffect(() => {
    selectedIssueIdRef.current = selectedIssueId
  }, [selectedIssueId])
  useEffect(() => {
    selectedIssueIdsRef.current = selectedIssueIds
  }, [selectedIssueIds])
  useEffect(() => {
    selectionAnchorIdRef.current = selectionAnchorId
  }, [selectionAnchorId])
  useEffect(() => {
    onSelectIssueRef.current = onSelectIssue
  }, [onSelectIssue])

  const { data: statuses = [], isSuccess: _statusesReady } = useStatuses(workspaceId)
  const { data: milestones = [], isSuccess: _milestonesReady } = useMilestones(workspaceId)
  const { data: allIssues = [], isSuccess: _issuesReady } = useBoardIssues({ workspaceId })
  const moveIssue = useMoveIssue()
  const moveExternalIssue = useMoveExternalIssue()

  useEffect(() => {
    if (initialMilestoneId) {
      setFilter({ milestoneId: initialMilestoneId })
    }
  }, [initialMilestoneId, setFilter])

  const parentIssueRefs = (() => {
    const nativeIssues = allIssues.filter(
      (issue): issue is KanbanIssue => !isExternalKanbanIssue(issue),
    )
    const issuesById = new Map(nativeIssues.map(issue => [issue.id, issue]))
    const refs = new Map<string, ParentIssueRef>()

    for (const issue of nativeIssues) {
      if (!issue.parentIssueId) {
        continue
      }

      const parentIssue = issuesById.get(issue.parentIssueId)
      refs.set(issue.id, {
        id: issue.parentIssueId,
        key: parentIssue
          ? formatIssueId(parentIssue, workspaces)
          : issue.parentIssueId.slice(0, 6).toUpperCase(),
      })
    }

    return refs
  })()

  // Apply filters
  const filteredIssues = (() => {
    let result = allIssues

    if (filter.statusIds?.length) {
      result = result.filter(i => i.statusId && filter.statusIds!.includes(i.statusId))
    }
    if (filter.priorities?.length) {
      result = result.filter(
        i =>
          !isExternalKanbanIssue(i)
          && filter.priorities!.includes(
            i.priority as FilterState['priorities'] extends (infer T)[] | undefined ? T : never,
          ),
      )
    }
    if (filter.labels?.length) {
      result = result.filter(i => filter.labels!.some(l => i.labels.includes(l)))
    }
    if (filter.milestoneId) {
      result = result.filter(
        i => !isExternalKanbanIssue(i) && i.milestoneId === filter.milestoneId,
      )
    }
    if (filter.isDelegated === true) {
      result = result.filter(
        i => !isExternalKanbanIssue(i) && (!!i.delegateAgentId || !!i.delegateProviderTargetId),
      )
    }

    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(
        i =>
          i.title.toLowerCase().includes(q)
          || i.id.toLowerCase().includes(q)
          || (isExternalKanbanIssue(i) && i.externalIssue.externalKey.toLowerCase().includes(q)),
      )
    }

    // Sort
    result = result.toSorted((a, b) => {
      const dir = config.orderDirection === 'asc' ? 1 : -1
      if (config.orderBy === 'priority') {
        const pOrder = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 }
        return (
          dir
          * ((pOrder[isExternalKanbanIssue(a) ? 'none' : (a.priority as keyof typeof pOrder)] ?? 4)
            - (pOrder[isExternalKanbanIssue(b) ? 'none' : (b.priority as keyof typeof pOrder)] ?? 4))
        )
      }
      if (config.orderBy === 'created') {
        return dir * ((a.createdAt ?? 0) - (b.createdAt ?? 0))
      }
      if (config.orderBy === 'updated') {
        return dir * ((a.updatedAt ?? 0) - (b.updatedAt ?? 0))
      }
      return dir * ((a.order ?? 0) - (b.order ?? 0))
    })

    return result
  })()

  const handleIssueClick = (id: string) => {
    onSelectIssue?.(id)
  }

  const handleOpenMilestone = (id: string) => {
    setFilter({ milestoneId: id })
    onOpenMilestone?.(id)
    onSelectIssue?.(null)
  }

  const handleMoveIssue = (issueId: string, targetGroupId: string) => {
    if (config.groupBy === 'status') {
      const issue = allIssues.find(candidate => candidate.id === issueId)
      if (issue && isExternalKanbanIssue(issue)) {
        moveExternalIssue.mutate({ id: issueId, statusId: targetGroupId })
        return
      }
      moveIssue.mutate({ id: issueId, statusId: targetGroupId })
    }
  }

  const handleCreateIssue = (groupId: string) => {
    setCreateDefaultStatusId(config.groupBy === 'status' ? groupId : undefined)
    setCreateDialogOpen(true)
  }

  const visibleIssues = orderedIssuesForKanbanView(filteredIssues, statuses, milestones, config)

  const visibleIssueIds = visibleIssues.map(issue => issue.id)

  const selectedIssues = visibleIssues.filter(issue => selectedIssueIds.has(issue.id))

  const focusedIssueId = (() => {
    if (focusedIndex >= 0 && focusedIndex < visibleIssues.length) {
      return visibleIssues[focusedIndex].id
    }
    return null
  })()

  const issuesById = new Map(allIssues.map(issue => [issue.id, issue]))
  const selectedExternalIssue = selectedIssueId ? issuesById.get(selectedIssueId) : null

  const kanbanFilterSummary = summarizeKanbanFilter(filter, statuses, milestones)

  useEffect(() => {
    updateKanbanAttentionSnapshot({
      boardId,
      workspaceId,
      layout: config.layout,
      visibleIssueCount: visibleIssues.length,
      selectedIssueIds: [...selectedIssueIds],
      selectedIssues: selectedIssues
        .map(issue => toContextIssue(issue, workspaces))
        .filter((issue): issue is KanbanContextIssue => Boolean(issue)),
      openIssue: toContextIssue(
        selectedIssueId ? issuesById.get(selectedIssueId) : null,
        workspaces,
      ),
      peekIssue: toContextIssue(peekIssueId ? issuesById.get(peekIssueId) : null, workspaces),
      focusedIssue: toContextIssue(
        focusedIssueId ? issuesById.get(focusedIssueId) : null,
        workspaces,
      ),
      hoveredIssue: toContextIssue(
        hoveredIssueId ? issuesById.get(hoveredIssueId) : null,
        workspaces,
      ),
      searchQuery: searchQuery.trim(),
      filterSummary: kanbanFilterSummary,
      updatedAt: Date.now(),
    })
  }, [
    boardId,
    config.layout,
    focusedIssueId,
    hoveredIssueId,
    issuesById,
    kanbanFilterSummary,
    peekIssueId,
    searchQuery,
    selectedIssueId,
    selectedIssueIds,
    selectedIssues,
    visibleIssues.length,
    workspaceId,
    workspaces,
  ])

  useEffect(() => {
    return () => {
      clearKanbanAttentionSnapshot(boardId)
    }
  }, [boardId])

  const clearSelectedIssues = () => {
    setSelectedIssueIds(new Set())
    setSelectionAnchorId(null)
    setFocusedIndex(-1)
    setPeekIssueId(null)
  }

  const selectAllVisibleIssues = () => {
    if (visibleIssuesRef.current.length === 0) {
      return
    }
    setSelectedIssueIds(new Set(visibleIssuesRef.current.map(issue => issue.id)))
    setSelectionAnchorId(visibleIssuesRef.current[0]?.id ?? null)
  }

  const extendSelectionToIssue = (issueId: string) => {
    const issueIds = visibleIssuesRef.current.map(issue => issue.id)
    const fallbackAnchorId
      = selectionAnchorIdRef.current ?? [...selectedIssueIdsRef.current][0] ?? issueId

    setSelectedIssueIds(prev => addIssueSelectionRange(prev, issueIds, fallbackAnchorId, issueId))
    setSelectionAnchorId(fallbackAnchorId)
  }

  const toggleIssueSelected = (issueId: string) => {
    const next = toggleIssueSelection(selectedIssueIdsRef.current, issueId)
    selectedIssueIdsRef.current = next
    setSelectedIssueIds(next)
    setSelectionAnchorId(next.has(issueId) ? issueId : ([...next][0] ?? null))
    if (!next.has(issueId)) {
      setFocusedIndex(-1)
    }
  }

  const handleIssueSelectionGesture = (issueId: string, mode: IssueSelectionMode) => {
    const index = visibleIssuesRef.current.findIndex(issue => issue.id === issueId)
    if (index >= 0) {
      setFocusedIndex(index)
    }
    if (mode === 'range') {
      extendSelectionToIssue(issueId)
      return
    }
    toggleIssueSelected(issueId)
  }

  // Keep visible issue order ref in sync with the rendered group layout.
  useEffect(() => {
    visibleIssuesRef.current = visibleIssues
  }, [visibleIssues])

  useEffect(() => {
    setSelectedIssueIds((prev) => {
      const visibleIds = new Set(visibleIssueIds)
      const next = new Set([...prev].filter(id => visibleIds.has(id)))
      return next.size === prev.size ? prev : next
    })
    if (selectionAnchorId && !visibleIssueIds.includes(selectionAnchorId)) {
      setSelectionAnchorId(null)
    }
  }, [selectionAnchorId, visibleIssueIds])

  // Keyboard navigation for peek and multi-selection
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (selectedIssueIdRef.current) {
        return
      }

      const target = event.target as HTMLElement | null
      if (
        target
        && (target.tagName === 'INPUT'
          || target.tagName === 'TEXTAREA'
          || target.tagName === 'SELECT'
          || target.isContentEditable
          || target.closest(
            '[data-slot="dialog-content"], [data-slot="popover-content"], [data-slot="dropdown-menu-content"]',
          ))
      ) {
        return
      }

      const issues = visibleIssuesRef.current
      if (issues.length === 0) {
        return
      }

      const curFocus = focusedIndexRef.current
      const curPeek = peekIssueIdRef.current
      const curHover = hoveredIssueIdRef.current
      const curSelectedIds = selectedIssueIdsRef.current

      // Resolve target index: keyboard focus > hover > first issue
      const resolveIndex = () => {
        if (curFocus >= 0 && curFocus < issues.length) {
          return curFocus
        }
        if (curHover) {
          const hoverIdx = issues.findIndex(i => i.id === curHover)
          if (hoverIdx >= 0) {
            return hoverIdx
          }
        }
        return 0
      }

      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        selectAllVisibleIssues()
        return
      }

      if (
        event.key === 'Escape'
        && curSelectedIds.size > 0
        && !event.metaKey
        && !event.ctrlKey
        && !event.altKey
      ) {
        event.preventDefault()
        clearSelectedIssues()
        return
      }

      if (event.key.toLowerCase() === 'x' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault()
        const idx = resolveIndex()
        const issueId = issues[idx]?.id
        if (!issueId) {
          return
        }
        setFocusedIndex(idx)
        if (event.shiftKey) {
          extendSelectionToIssue(issueId)
          return
        }
        toggleIssueSelected(issueId)
        return
      }

      if (
        event.shiftKey
        && !event.metaKey
        && !event.ctrlKey
        && !event.altKey
        && (event.key === 'ArrowDown'
          || event.key === 'ArrowUp'
          || event.key.toLowerCase() === 'j'
          || event.key.toLowerCase() === 'k')
      ) {
        event.preventDefault()
        const startIdx = resolveIndex()
        const next
          = event.key === 'ArrowDown' || event.key.toLowerCase() === 'j'
            ? Math.min(startIdx + 1, issues.length - 1)
            : Math.max(startIdx - 1, 0)
        setFocusedIndex(next)
        if (curPeek) {
          setPeekIssueId(issues[next]?.id ?? null)
        }
        const issueId = issues[next]?.id
        if (issueId) {
          if (curSelectedIds.size === 0) {
            const anchorIssueId = issues[startIdx]?.id ?? issueId
            setSelectedIssueIds(new Set([anchorIssueId]))
            setSelectionAnchorId(anchorIssueId)
          }
          extendSelectionToIssue(issueId)
        }
        return
      }

      // J or Down arrow: move focus down
      if (
        (event.key === 'j' || event.key === 'ArrowDown')
        && !event.metaKey
        && !event.ctrlKey
        && !event.altKey
      ) {
        event.preventDefault()
        const startIdx = resolveIndex()
        const next = Math.min(startIdx + 1, issues.length - 1)
        setFocusedIndex(next)
        if (curPeek) {
          setPeekIssueId(issues[next]?.id ?? null)
        }
        return
      }

      // K or Up arrow: move focus up
      if (
        (event.key === 'k' || event.key === 'ArrowUp')
        && !event.metaKey
        && !event.ctrlKey
        && !event.altKey
      ) {
        event.preventDefault()
        const startIdx = resolveIndex()
        const next = Math.max(startIdx - 1, 0)
        setFocusedIndex(next)
        if (curPeek) {
          setPeekIssueId(issues[next]?.id ?? null)
        }
        return
      }

      // Space: toggle or hold peek
      if (event.key === ' ' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.repeat) {
        event.preventDefault()
        spaceDownTimeRef.current = Date.now()
        peekWasOpenRef.current = !!curPeek

        const idx = resolveIndex()
        setFocusedIndex(idx)
        setPeekIssueId(issues[idx]?.id ?? null)
        return
      }

      // Enter: open full detail from peek
      if (event.key === 'Enter' && curPeek && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault()
        onSelectIssueRef.current?.(curPeek)
        return
      }

      // Escape: close peek
      if (event.key === 'Escape' && curPeek && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault()
        setPeekIssueId(null)
        setFocusedIndex(-1)
      }
    }

    function handleKeyUp(event: KeyboardEvent) {
      if (event.key === ' ') {
        const holdDuration = Date.now() - spaceDownTimeRef.current
        if (holdDuration > 300) {
          setPeekIssueId(null)
          setFocusedIndex(-1)
        }
 else if (peekWasOpenRef.current) {
          setPeekIssueId(null)
          setFocusedIndex(-1)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [clearSelectedIssues, extendSelectionToIssue, selectAllVisibleIssues, toggleIssueSelected])

  // Follow hover when peek is active
  useEffect(() => {
    if (peekIssueId && hoveredIssueId && hoveredIssueId !== peekIssueId) {
      setPeekIssueId(hoveredIssueId)
      // Sync focusedIndex so next keyboard nav starts from the hovered issue
      const idx = visibleIssues.findIndex(i => i.id === hoveredIssueId)
      if (idx >= 0) {
        setFocusedIndex(idx)
      }
    }
  }, [hoveredIssueId, peekIssueId, visibleIssues])

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden h-full">
      <BetaNotice title={t('beta.title')} description={t('beta.description')} />

      {/* eslint-disable-next-line style/multiline-ternary */}
      {selectedIssueId ? (
        selectedExternalIssue && isExternalKanbanIssue(selectedExternalIssue)
? (
          <IssueDetail
            issueId={selectedIssueId}
            workspaceId={workspaceId}
            issues={allIssues.filter(
              (issue): issue is KanbanIssue => !isExternalKanbanIssue(issue),
            )}
            issueOverride={selectedExternalIssue}
            readOnly
            onOpenIssue={handleIssueClick}
            onOpenMilestone={handleOpenMilestone}
            onBack={() => onSelectIssue?.(null)}
          />
        )
: (
          <IssueDetail
            issueId={selectedIssueId}
            workspaceId={workspaceId}
            issues={allIssues.filter(
              (issue): issue is KanbanIssue => !isExternalKanbanIssue(issue),
            )}
            onOpenIssue={handleIssueClick}
            onOpenMilestone={handleOpenMilestone}
            onBack={() => onSelectIssue?.(null)}
          />
        )
      ) : (
        <>
          <KanbanToolbar
            workspaceId={workspaceId}
            config={config}
            setConfig={setConfig}
            filter={filter}
            setFilter={setFilter}
            resetFilter={resetFilter}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onCreateIssue={() => setCreateDialogOpen(true)}
          />

          {config.layout === 'board' && (
            <KanbanBoard
              workspaceId={workspaceId}
              issues={filteredIssues}
              statuses={statuses}
              milestones={milestones}
              parentIssueRefs={parentIssueRefs}
              config={config}
              onIssueClick={handleIssueClick}
              onIssueSelectionGesture={handleIssueSelectionGesture}
              onIssueHover={setHoveredIssueId}
              onMoveIssue={handleMoveIssue}
              onCreateIssue={handleCreateIssue}
              highlightedIssueId={focusedIssueId}
              selectedIssueIds={selectedIssueIds}
            />
          )}

          {config.layout === 'list' && (
            <KanbanList
              issues={filteredIssues}
              statuses={statuses}
              milestones={milestones}
              parentIssueRefs={parentIssueRefs}
              config={config}
              highlightedIssueId={focusedIssueId}
              selectedIssueIds={selectedIssueIds}
              onIssueClick={handleIssueClick}
              onIssueSelectionGesture={handleIssueSelectionGesture}
              onIssueHover={setHoveredIssueId}
              onCreateIssue={handleCreateIssue}
            />
          )}

          <KanbanSelectionBar
            issues={selectedIssues}
            statuses={statuses}
            onClear={clearSelectedIssues}
          />

          <CreateIssueDialog
            workspaceId={workspaceId}
            issues={allIssues.filter(
              (issue): issue is KanbanIssue => !isExternalKanbanIssue(issue),
            )}
            defaultStatusId={createDefaultStatusId}
            open={createDialogOpen}
            onClose={() => setCreateDialogOpen(false)}
          />

          {/* Peek panel */}
          <IssuePeekPanel
            issueId={peekIssueId}
            issue={peekIssueId ? issuesById.get(peekIssueId) : null}
            workspaceId={workspaceId}
            onClose={() => setPeekIssueId(null)}
            onOpenDetail={id => onSelectIssue?.(id)}
          />
        </>
      )}
    </div>
  )
}
