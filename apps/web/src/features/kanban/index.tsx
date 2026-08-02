import { AnimatePresence, m } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BetaNotice } from '~/components/common/beta-notice'
import type {
  KanbanBoard,
  KanbanBoardIssue,
  KanbanIssue,
  KanbanMilestone,
  KanbanStatus,
} from '~/features/kanban/types'
import { isExternalKanbanIssue } from '~/features/kanban/types'
import type { Workspace } from '~/features/workspace/types'
import { useWorkspaces } from '~/features/workspace/use-workspace'
import { cn } from '~/lib/cn'

import { CreateIssueDialog } from './create-issue-dialog'
import { IssueDetail } from './issue-detail'
import type { KanbanDropResult } from './kanban-board'
import { KanbanBoardSurface } from './kanban-board'
import type { KanbanContextIssue } from './kanban-context'
import {
  clearKanbanAttentionSnapshot,
  updateKanbanAttentionSnapshot,
} from './kanban-context'
import type { KanbanGroupAssignPatch } from './kanban-grouping'
import { buildKanbanGroups, groupKanbanIssues, orderedIssuesForGroups } from './kanban-grouping'
import { KanbanList } from './kanban-list'
import type { IssueSelectionMode } from './kanban-selection'
import { addIssueSelectionRange, toggleIssueSelection } from './kanban-selection'
import { KanbanSelectionBar } from './kanban-selection-bar'
import { KanbanToolbar } from './kanban-toolbar'
import { formatIssueId } from './shared/format-issue-id'
import type { ParentIssueRef } from './shared/parent-issue-ref'
import type { FilterState } from './use-board-view'
import { hasActiveFilter, useBoardView } from './use-board-view'
import {
  useBoardIssues,
  useMilestones,
  useMoveExternalIssue,
  useReorderIssues,
  useStatuses,
} from './use-kanban'
import { useKanbanKeyboard } from './use-kanban-keyboard'

const ISSUE_DETAIL_SPRING = {
  type: 'spring',
  stiffness: 500,
  damping: 42,
  mass: 0.8,
} as const

interface KanbanViewProps {
  board: KanbanBoard
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
    const statusNames = filter.statusIds.map(
      statusId => statuses.find(candidate => candidate.id === statusId)?.name ?? statusId,
    )
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

const priorityRank = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 } as const

export function KanbanView({
  board,
  selectedIssueId,
  initialMilestoneId,
  onSelectIssue,
  onOpenMilestone,
}: KanbanViewProps) {
  const { t } = useTranslation('kanban')
  const boardId = board.id
  const workspaceId = board.workspaceId
  const { view, setConfig, setFilter, resetFilter } = useBoardView(board)
  const { workspaces } = useWorkspaces()
  const [searchQuery, setSearchQuery] = useState('')
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [createDefaults, setCreateDefaults] = useState<KanbanGroupAssignPatch | null>(null)
  const [selectedIssueIds, setSelectedIssueIds] = useState<Set<string>>(() => new Set())
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null)
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const [hoveredIssueId, setHoveredIssueId] = useState<string | null>(null)

  const { data: statuses = [] } = useStatuses(workspaceId)
  const { data: milestones = [] } = useMilestones(workspaceId)
  const { data: allIssues = [] } = useBoardIssues({ workspaceId })
  const reorderIssues = useReorderIssues()
  const moveExternalIssue = useMoveExternalIssue()
  const detailOpen = Boolean(selectedIssueId)

  // A milestone deep-link seeds the filter once; it must not fight later edits.
  const appliedMilestoneRef = useRef<string | null>(null)
  useEffect(() => {
    if (!initialMilestoneId || appliedMilestoneRef.current === initialMilestoneId) {
      return
    }
    appliedMilestoneRef.current = initialMilestoneId
    setFilter({ milestoneId: initialMilestoneId })
  }, [initialMilestoneId, setFilter])

  const nativeIssues = useMemo(
    () => allIssues.filter((issue): issue is KanbanIssue => !isExternalKanbanIssue(issue)),
    [allIssues],
  )

  const parentIssueRefs = useMemo(() => {
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
  }, [nativeIssues, workspaces])

  const labelOptions = useMemo(() => {
    const seen = new Set<string>()
    for (const issue of allIssues) {
      for (const label of issue.labels) {
        seen.add(label)
      }
    }
    return [...seen].sort((left, right) => left.localeCompare(right))
  }, [allIssues])

  const statusRank = useMemo(
    () => new Map(statuses.map((status, index) => [status.id, index])),
    [statuses],
  )

  const filteredIssues = useMemo(() => {
    const { filter } = view
    let result = allIssues

    if (filter.statusIds?.length) {
      const allowed = new Set(filter.statusIds)
      result = result.filter(issue => issue.statusId && allowed.has(issue.statusId))
    }
    if (filter.priorities?.length) {
      const allowed = new Set<string>(filter.priorities)
      result = result.filter(issue => allowed.has(issue.priority))
    }
    if (filter.labels?.length) {
      const allowed = new Set(filter.labels)
      result = result.filter(issue => issue.labels.some(label => allowed.has(label)))
    }
    if (filter.milestoneId) {
      result = result.filter(issue => issue.milestoneId === filter.milestoneId)
    }
    if (filter.isDelegated != null) {
      result = result.filter((issue) => {
        const delegated = !isExternalKanbanIssue(issue)
          && Boolean(issue.delegateAgentId || issue.delegateProviderTargetId)
        return delegated === filter.isDelegated
      })
    }

    const needle = searchQuery.trim().toLowerCase()
    if (needle) {
      result = result.filter(issue =>
        issue.title.toLowerCase().includes(needle)
        || formatIssueId(issue, workspaces).toLowerCase().includes(needle)
        || (isExternalKanbanIssue(issue)
          && issue.externalIssue.externalKey.toLowerCase().includes(needle)))
    }

    const direction = view.orderDirection === 'asc' ? 1 : -1
    return result.toSorted((left, right) => {
      if (view.orderBy === 'priority') {
        return direction * (priorityRank[left.priority] - priorityRank[right.priority])
      }
      if (view.orderBy === 'status') {
        const leftRank = statusRank.get(left.statusId ?? '') ?? statuses.length
        const rightRank = statusRank.get(right.statusId ?? '') ?? statuses.length
        return direction * (leftRank - rightRank)
      }
      if (view.orderBy === 'created') {
        return direction * ((left.createdAt ?? 0) - (right.createdAt ?? 0))
      }
      if (view.orderBy === 'updated') {
        return direction * ((left.updatedAt ?? 0) - (right.updatedAt ?? 0))
      }
      return direction * ((left.order ?? 0) - (right.order ?? 0))
    })
  }, [allIssues, searchQuery, statusRank, statuses.length, view, workspaces])

  const groups = useMemo(
    () =>
      buildKanbanGroups({
        groupBy: view.groupBy,
        statuses,
        milestones,
        issues: allIssues,
        t,
      }),
    [allIssues, milestones, statuses, t, view.groupBy],
  )

  const grouped = useMemo(
    () =>
      groupKanbanIssues({
        issues: filteredIssues,
        groups,
        groupBy: view.groupBy,
        showEmptyGroups: view.showEmptyGroups,
      }),
    [filteredIssues, groups, view.groupBy, view.showEmptyGroups],
  )

  const visibleIssues = useMemo(() => orderedIssuesForGroups(grouped), [grouped])
  const visibleIssuesRef = useRef(visibleIssues)
  visibleIssuesRef.current = visibleIssues

  const issuesById = useMemo(
    () => new Map(allIssues.map(issue => [issue.id, issue])),
    [allIssues],
  )

  const selectedIssues = useMemo(
    () => visibleIssues.filter(issue => selectedIssueIds.has(issue.id)),
    [selectedIssueIds, visibleIssues],
  )

  const focusedIssueId
    = focusedIndex >= 0 && focusedIndex < visibleIssues.length ? visibleIssues[focusedIndex].id : null

  // ── Selection ───────────────────────────────────────────────────────────────

  const clearSelection = useCallback(() => {
    setSelectedIssueIds(new Set())
    setSelectionAnchorId(null)
    setFocusedIndex(-1)
  }, [])

  const selectAll = useCallback(() => {
    const issues = visibleIssuesRef.current
    if (issues.length === 0) {
      return
    }
    setSelectedIssueIds(new Set(issues.map(issue => issue.id)))
    setSelectionAnchorId(issues[0].id)
  }, [])

  const toggleSelection = useCallback((issueId: string) => {
    setSelectedIssueIds((prev) => {
      const next = toggleIssueSelection(prev, issueId)
      setSelectionAnchorId(next.has(issueId) ? issueId : ([...next][0] ?? null))
      return next
    })
  }, [])

  const extendSelection = useCallback((issueId: string) => {
    const issueIds = visibleIssuesRef.current.map(issue => issue.id)
    setSelectedIssueIds((prev) => {
      const anchorId = selectionAnchorId ?? [...prev][0] ?? issueId
      setSelectionAnchorId(anchorId)
      return addIssueSelectionRange(prev, issueIds, anchorId, issueId)
    })
  }, [selectionAnchorId])

  const handleSelectionGesture = useCallback(
    (issueId: string, mode: IssueSelectionMode) => {
      const index = visibleIssuesRef.current.findIndex(issue => issue.id === issueId)
      if (index >= 0) {
        setFocusedIndex(index)
      }
      if (mode === 'range') {
        extendSelection(issueId)
        return
      }
      toggleSelection(issueId)
    },
    [extendSelection, toggleSelection],
  )

  // Drop selections for issues that filtering or deletion took off the board.
  useEffect(() => {
    const visibleIds = new Set(visibleIssues.map(issue => issue.id))
    setSelectedIssueIds((prev) => {
      const next = new Set([...prev].filter(id => visibleIds.has(id)))
      return next.size === prev.size ? prev : next
    })
    setSelectionAnchorId(prev => (prev && !visibleIds.has(prev) ? null : prev))
  }, [visibleIssues])

  // ── Actions ─────────────────────────────────────────────────────────────────

  const openIssue = useCallback((issueId: string) => onSelectIssue?.(issueId), [onSelectIssue])

  const handleOpenMilestone = useCallback(
    (milestoneId: string) => {
      setFilter({ milestoneId })
      onOpenMilestone?.(milestoneId)
      onSelectIssue?.(null)
    },
    [onOpenMilestone, onSelectIssue, setFilter],
  )

  /**
   * A drop carries both a destination group and a position within it.
   *
   * Both are persisted in one request so the card cannot land in the right
   * column at the wrong index — the previous handler applied only the group
   * patch, leaving a stale `order` to decide where the card actually settled.
   */
  const handleIssueDrop = useCallback(
    ({ issueId, fromGroupId, toGroupId, orderedIds }: KanbanDropResult) => {
      const issue = issuesById.get(issueId)
      const changedGroup = fromGroupId !== toGroupId

      if (issue && isExternalKanbanIssue(issue)) {
        // External items mirror another tracker: status is the only writable
        // field, and their position is not ours to persist.
        const patch = groups.find(group => group.id === toGroupId)?.assignPatch
        if (changedGroup && patch && 'statusId' in patch) {
          moveExternalIssue.mutate({ id: issueId, statusId: patch.statusId })
        }
        return
      }

      // Reordering across a mixed column must not renumber external ids the
      // Issue module does not own.
      const localOrderedIds = orderedIds.filter((id) => {
        const candidate = issuesById.get(id)
        return !candidate || !isExternalKanbanIssue(candidate)
      })

      const assignPatch = changedGroup
        ? groups.find(group => group.id === toGroupId)?.assignPatch
        : undefined

      reorderIssues.mutate({
        workspaceId,
        orderedIds: localOrderedIds,
        patch: assignPatch ? { issueIds: [issueId], fields: assignPatch } : undefined,
      })
    },
    [groups, issuesById, moveExternalIssue, reorderIssues, workspaceId],
  )

  const handleCreateInGroup = useCallback(
    (groupId: string) => {
      setCreateDefaults(groups.find(group => group.id === groupId)?.assignPatch ?? null)
      setCreateDialogOpen(true)
    },
    [groups],
  )

  useKanbanKeyboard({
    visibleIssues,
    focusedIndex,
    hoveredIssueId,
    selectedCount: selectedIssueIds.size,
    detailOpen,
    setFocusedIndex,
    openIssue,
    toggleSelection,
    extendSelection,
    selectAll,
    clearSelection,
  })

  // ── Attention context ───────────────────────────────────────────────────────

  const kanbanFilterSummary = summarizeKanbanFilter(view.filter, statuses, milestones)

  useEffect(() => {
    updateKanbanAttentionSnapshot({
      boardId,
      workspaceId,
      layout: view.layout,
      visibleIssueCount: visibleIssues.length,
      selectedIssueIds: [...selectedIssueIds],
      selectedIssues: selectedIssues
        .map(issue => toContextIssue(issue, workspaces))
        .filter((issue): issue is KanbanContextIssue => Boolean(issue)),
      openIssue: toContextIssue(
        selectedIssueId ? issuesById.get(selectedIssueId) : null,
        workspaces,
      ),
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
    focusedIssueId,
    hoveredIssueId,
    issuesById,
    kanbanFilterSummary,
    searchQuery,
    selectedIssueId,
    selectedIssueIds,
    selectedIssues,
    view.layout,
    visibleIssues.length,
    workspaceId,
    workspaces,
  ])

  useEffect(() => () => clearKanbanAttentionSnapshot(boardId), [boardId])

  const openedIssue = selectedIssueId ? issuesById.get(selectedIssueId) : null
  // External items have no native issue row to load, so the board's copy is the record.
  const openedExternalIssue = isExternalKanbanIssue(openedIssue) ? openedIssue : undefined

  return (
    <div className="relative flex h-full flex-1 flex-col overflow-hidden">
      {/*
        The board stays mounted behind the detail. Unmounting it threw away column
        scroll offsets, collapsed groups, and the current selection on every open,
        which is what made opening an issue feel like a page load.
      */}
      <div
        className={cn(
          'flex flex-1 flex-col overflow-hidden',
          detailOpen && 'pointer-events-none invisible absolute inset-0',
        )}
        aria-hidden={detailOpen}
        inert={detailOpen}
      >
        <BetaNotice title={t('beta.title')} description={t('beta.description')} />

        <KanbanToolbar
          workspaceId={workspaceId}
          config={view}
          setConfig={setConfig}
          filter={view.filter}
          setFilter={setFilter}
          resetFilter={resetFilter}
          statuses={statuses}
          milestones={milestones}
          labelOptions={labelOptions}
          issueCount={filteredIssues.length}
          totalIssueCount={allIssues.length}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onCreateIssue={() => {
            setCreateDefaults(null)
            setCreateDialogOpen(true)
          }}
        />

        {visibleIssues.length === 0 && allIssues.length > 0
          ? (
              <EmptyResults
                onClear={() => {
                  setSearchQuery('')
                  resetFilter()
                }}
                showClear={hasActiveFilter(view.filter) || searchQuery.trim().length > 0}
              />
            )
          : view.layout === 'board'
            ? (
                <KanbanBoardSurface
                  workspaceId={workspaceId}
                  grouped={grouped}
                  statuses={statuses}
                  milestones={milestones}
                  parentIssueRefs={parentIssueRefs}
                  config={view}
                  onIssueClick={openIssue}
                  onIssueSelectionGesture={handleSelectionGesture}
                  onIssueHover={setHoveredIssueId}
                  onIssueDrop={handleIssueDrop}
                  onCreateIssue={handleCreateInGroup}
                  highlightedIssueId={focusedIssueId}
                  selectedIssueIds={selectedIssueIds}
                />
              )
            : (
                <KanbanList
                  grouped={grouped}
                  statuses={statuses}
                  milestones={milestones}
                  parentIssueRefs={parentIssueRefs}
                  config={view}
                  highlightedIssueId={focusedIssueId}
                  selectedIssueIds={selectedIssueIds}
                  onIssueClick={openIssue}
                  onIssueSelectionGesture={handleSelectionGesture}
                  onIssueHover={setHoveredIssueId}
                  onCreateIssue={handleCreateInGroup}
                />
              )}

        <KanbanSelectionBar
          issues={selectedIssues}
          statuses={statuses}
          milestones={milestones}
          onClear={clearSelection}
        />

        <CreateIssueDialog
          workspaceId={workspaceId}
          issues={nativeIssues}
          defaults={createDefaults}
          open={createDialogOpen}
          onClose={() => setCreateDialogOpen(false)}
        />
      </div>

      <AnimatePresence>
        {selectedIssueId && (
          <m.div
            key="issue-detail"
            className="flex flex-1 flex-col overflow-hidden"
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8 }}
            transition={ISSUE_DETAIL_SPRING}
          >
            <IssueDetail
              issueId={selectedIssueId}
              workspaceId={workspaceId}
              issues={nativeIssues}
              issueOverride={openedExternalIssue}
              readOnly={Boolean(openedExternalIssue)}
              onOpenIssue={openIssue}
              onOpenMilestone={handleOpenMilestone}
              onBack={() => onSelectIssue?.(null)}
            />
          </m.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function EmptyResults({ onClear, showClear }: { onClear: () => void, showClear: boolean }) {
  const { t } = useTranslation('kanban')

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
      <p className="text-[13px] text-foreground">{t('empty.noMatches')}</p>
      <p className="text-[12px] text-muted-foreground">{t('empty.noMatchesHint')}</p>
      {showClear && (
        <button
          type="button"
          onClick={onClear}
          className="mt-1 rounded-md border border-border px-2.5 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-fill hover:text-foreground"
        >
          {t('filter.clear')}
        </button>
      )}
    </div>
  )
}
