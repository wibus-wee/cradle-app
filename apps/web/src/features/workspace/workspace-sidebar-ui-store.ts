import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { persistStorage } from '~/store/persist-storage'

type WorkspaceSidebarFlagMap = Record<string, true>

export type WorkspaceSidebarGrouping = 'workspace' | 'updated' | 'status' | 'environment'
export type WorkspaceSidebarSessionOrdering = 'updated' | 'created'
export type WorkspaceSidebarOrderingDirection = 'asc' | 'desc'

export type WorkspaceSidebarStatusFilter = 'unread' | 'streaming' | 'error' | 'needsYou'
export type WorkspaceSidebarWorkPrFilter = 'work' | 'draft' | 'ready' | 'merged'
export type WorkspaceSidebarEnvironmentFilter = 'local' | 'remote'
export type WorkspaceSidebarSourceFilter = 'chat' | 'work' | 'automation' | 'review'

export const SESSION_PREVIEW_LIMIT_OPTIONS = [3, 5, 8, 10, 15, 20] as const
export const DEFAULT_SESSION_PREVIEW_LIMIT = 5
export const MIN_SESSION_PREVIEW_LIMIT = SESSION_PREVIEW_LIMIT_OPTIONS[0]
export const MAX_SESSION_PREVIEW_LIMIT = SESSION_PREVIEW_LIMIT_OPTIONS.at(-1) ?? DEFAULT_SESSION_PREVIEW_LIMIT

export const WORKSPACE_SIDEBAR_GROUPINGS = [
  'workspace',
  'updated',
  'status',
  'environment',
] as const satisfies readonly WorkspaceSidebarGrouping[]

export const WORKSPACE_SIDEBAR_SESSION_ORDERINGS = [
  'updated',
  'created',
] as const satisfies readonly WorkspaceSidebarSessionOrdering[]

export const WORKSPACE_SIDEBAR_STATUS_FILTERS = [
  'unread',
  'streaming',
  'error',
  'needsYou',
] as const satisfies readonly WorkspaceSidebarStatusFilter[]

export const WORKSPACE_SIDEBAR_WORK_PR_FILTERS = [
  'work',
  'draft',
  'ready',
  'merged',
] as const satisfies readonly WorkspaceSidebarWorkPrFilter[]

export const WORKSPACE_SIDEBAR_ENVIRONMENT_FILTERS = [
  'local',
  'remote',
] as const satisfies readonly WorkspaceSidebarEnvironmentFilter[]

export const WORKSPACE_SIDEBAR_SOURCE_FILTERS = [
  'chat',
  'work',
  'automation',
  'review',
] as const satisfies readonly WorkspaceSidebarSourceFilter[]

export interface WorkspaceSidebarListFilters {
  statusFilters: WorkspaceSidebarStatusFilter[]
  workPrFilters: WorkspaceSidebarWorkPrFilter[]
  environmentFilters: WorkspaceSidebarEnvironmentFilter[]
  sourceFilters: WorkspaceSidebarSourceFilter[]
  showArchived: boolean
}

export const DEFAULT_WORKSPACE_SIDEBAR_LIST_FILTERS: WorkspaceSidebarListFilters = {
  statusFilters: [],
  workPrFilters: [],
  environmentFilters: [],
  sourceFilters: [],
  showArchived: false,
}

export const DEFAULT_WORKSPACE_SIDEBAR_GROUPING: WorkspaceSidebarGrouping = 'workspace'
export const DEFAULT_WORKSPACE_SIDEBAR_SESSION_ORDERING: WorkspaceSidebarSessionOrdering = 'updated'
export const DEFAULT_WORKSPACE_SIDEBAR_ORDERING_DIRECTION: WorkspaceSidebarOrderingDirection = 'desc'

interface WorkspaceSidebarUiState {
  collapsedWorkspaceIds: WorkspaceSidebarFlagMap
  expandedSessionListWorkspaceIds: WorkspaceSidebarFlagMap
  expandedSessionGroupIds: WorkspaceSidebarFlagMap
  sessionPreviewLimit: number
  grouping: WorkspaceSidebarGrouping
  sessionOrdering: WorkspaceSidebarSessionOrdering
  orderingDirection: WorkspaceSidebarOrderingDirection
  statusFilters: WorkspaceSidebarStatusFilter[]
  workPrFilters: WorkspaceSidebarWorkPrFilter[]
  environmentFilters: WorkspaceSidebarEnvironmentFilter[]
  sourceFilters: WorkspaceSidebarSourceFilter[]
  showArchived: boolean
  setGrouping: (grouping: WorkspaceSidebarGrouping) => void
  setSessionOrdering: (ordering: WorkspaceSidebarSessionOrdering) => void
  setOrderingDirection: (direction: WorkspaceSidebarOrderingDirection) => void
  toggleStatusFilter: (filter: WorkspaceSidebarStatusFilter) => void
  toggleWorkPrFilter: (filter: WorkspaceSidebarWorkPrFilter) => void
  toggleEnvironmentFilter: (filter: WorkspaceSidebarEnvironmentFilter) => void
  toggleSourceFilter: (filter: WorkspaceSidebarSourceFilter) => void
  setShowArchived: (showArchived: boolean) => void
  clearListFilters: () => void
  setSessionPreviewLimit: (limit: number) => void
  setWorkspaceExpanded: (workspaceId: string, expanded: boolean) => void
  toggleWorkspaceExpanded: (workspaceId: string) => void
  collapseAllWorkspaces: (workspaceIds: readonly string[]) => void
  setWorkspaceSessionListExpanded: (workspaceId: string, expanded: boolean) => void
  toggleWorkspaceSessionListExpanded: (workspaceId: string) => void
  setSessionGroupExpanded: (groupId: string, expanded: boolean) => void
  toggleSessionGroupExpanded: (groupId: string) => void
  pruneWorkspaceSidebarState: (workspaceIds: readonly string[]) => void
}

interface PersistedWorkspaceSidebarUiState {
  collapsedWorkspaceIds?: WorkspaceSidebarFlagMap
  expandedSessionListWorkspaceIds?: WorkspaceSidebarFlagMap
  expandedSessionGroupIds?: WorkspaceSidebarFlagMap
  sessionPreviewLimit?: unknown
  grouping?: unknown
  sessionOrdering?: unknown
  orderingDirection?: unknown
  statusFilters?: unknown
  workPrFilters?: unknown
  environmentFilters?: unknown
  sourceFilters?: unknown
  showArchived?: unknown
  // Legacy (v2/v3) fields, only read during migration.
  projectFilter?: unknown
  projectSortKey?: unknown
  projectSortDirection?: unknown
}

const GROUPINGS = new Set<WorkspaceSidebarGrouping>(WORKSPACE_SIDEBAR_GROUPINGS)
const SESSION_ORDERINGS = new Set<WorkspaceSidebarSessionOrdering>(WORKSPACE_SIDEBAR_SESSION_ORDERINGS)
const ORDERING_DIRECTIONS = new Set<WorkspaceSidebarOrderingDirection>(['asc', 'desc'])
const STATUS_FILTERS = new Set<WorkspaceSidebarStatusFilter>(WORKSPACE_SIDEBAR_STATUS_FILTERS)
const WORK_PR_FILTERS = new Set<WorkspaceSidebarWorkPrFilter>(WORKSPACE_SIDEBAR_WORK_PR_FILTERS)
const ENVIRONMENT_FILTERS = new Set<WorkspaceSidebarEnvironmentFilter>(WORKSPACE_SIDEBAR_ENVIRONMENT_FILTERS)
const SOURCE_FILTERS = new Set<WorkspaceSidebarSourceFilter>(WORKSPACE_SIDEBAR_SOURCE_FILTERS)

function setFlag(map: WorkspaceSidebarFlagMap, key: string, enabled: boolean): WorkspaceSidebarFlagMap {
  if (enabled) {
    if (map[key]) {
      return map
    }
    return { ...map, [key]: true }
  }

  if (!map[key]) {
    return map
  }
  const { [key]: _removed, ...next } = map
  return next
}

function pruneFlags(map: WorkspaceSidebarFlagMap, allowedIds: ReadonlySet<string>): WorkspaceSidebarFlagMap {
  let changed = false
  const next: WorkspaceSidebarFlagMap = {}

  for (const [workspaceId, enabled] of Object.entries(map)) {
    if (enabled && allowedIds.has(workspaceId)) {
      next[workspaceId] = true
    }
    else {
      changed = true
    }
  }

  return changed ? next : map
}

function normalizeFlags(value: unknown): WorkspaceSidebarFlagMap {
  if (!value || typeof value !== 'object') {
    return {}
  }

  const flags: WorkspaceSidebarFlagMap = {}
  for (const [workspaceId, enabled] of Object.entries(value)) {
    if (enabled === true) {
      flags[workspaceId] = true
    }
  }
  return flags
}

function normalizeFilterList<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
): T[] {
  if (!Array.isArray(value)) {
    return []
  }
  const next: T[] = []
  for (const entry of value) {
    if (typeof entry === 'string' && allowed.has(entry as T) && !next.includes(entry as T)) {
      next.push(entry as T)
    }
  }
  return next
}

function normalizeGrouping(value: unknown): WorkspaceSidebarGrouping {
  return typeof value === 'string' && GROUPINGS.has(value as WorkspaceSidebarGrouping)
    ? value as WorkspaceSidebarGrouping
    : DEFAULT_WORKSPACE_SIDEBAR_GROUPING
}

function normalizeSessionOrdering(value: unknown): WorkspaceSidebarSessionOrdering {
  return typeof value === 'string' && SESSION_ORDERINGS.has(value as WorkspaceSidebarSessionOrdering)
    ? value as WorkspaceSidebarSessionOrdering
    : DEFAULT_WORKSPACE_SIDEBAR_SESSION_ORDERING
}

function normalizeOrderingDirection(value: unknown): WorkspaceSidebarOrderingDirection {
  return typeof value === 'string' && ORDERING_DIRECTIONS.has(value as WorkspaceSidebarOrderingDirection)
    ? value as WorkspaceSidebarOrderingDirection
    : DEFAULT_WORKSPACE_SIDEBAR_ORDERING_DIRECTION
}

function normalizeSessionPreviewLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_SESSION_PREVIEW_LIMIT
  }
  const clamped = Math.min(Math.max(Math.round(value), MIN_SESSION_PREVIEW_LIMIT), MAX_SESSION_PREVIEW_LIMIT)
  return clamped
}

/**
 * Legacy v2 `projectFilter` facets that still map onto v4 status filters.
 * Scope-like values (`pinned` / `unpinned`) have no v4 equivalent and are dropped.
 */
function migrateLegacyProjectFilterStatusFilters(value: unknown): WorkspaceSidebarStatusFilter[] {
  switch (value) {
    case 'unread':
      return ['unread']
    case 'running':
      return ['streaming']
    default:
      return []
  }
}

function toggleInList<T extends string>(list: readonly T[], value: T): T[] {
  return list.includes(value)
    ? list.filter(entry => entry !== value)
    : [...list, value]
}

function sameStringList(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false
  }
  return left.every((entry, index) => entry === right[index])
}

export function listFiltersAreActive(filters: WorkspaceSidebarListFilters): boolean {
  return filters.statusFilters.length > 0
    || filters.workPrFilters.length > 0
    || filters.environmentFilters.length > 0
    || filters.sourceFilters.length > 0
    || filters.showArchived
}

export function rowFiltersAreActive(filters: WorkspaceSidebarListFilters): boolean {
  return filters.statusFilters.length > 0
    || filters.workPrFilters.length > 0
    || filters.environmentFilters.length > 0
    || filters.sourceFilters.length > 0
}

export const useWorkspaceSidebarUiStore = create<WorkspaceSidebarUiState>()(
  persist(
    set => ({
      collapsedWorkspaceIds: {},
      expandedSessionListWorkspaceIds: {},
      expandedSessionGroupIds: {},
      sessionPreviewLimit: DEFAULT_SESSION_PREVIEW_LIMIT,
      grouping: DEFAULT_WORKSPACE_SIDEBAR_GROUPING,
      sessionOrdering: DEFAULT_WORKSPACE_SIDEBAR_SESSION_ORDERING,
      orderingDirection: DEFAULT_WORKSPACE_SIDEBAR_ORDERING_DIRECTION,
      ...DEFAULT_WORKSPACE_SIDEBAR_LIST_FILTERS,
      setGrouping: grouping => set(state =>
        state.grouping === grouping ? state : { grouping }),
      setSessionOrdering: sessionOrdering => set(state =>
        state.sessionOrdering === sessionOrdering ? state : { sessionOrdering }),
      setOrderingDirection: orderingDirection => set(state =>
        state.orderingDirection === orderingDirection ? state : { orderingDirection }),
      toggleStatusFilter: filter => set((state) => {
        const statusFilters = toggleInList(state.statusFilters, filter)
        return sameStringList(state.statusFilters, statusFilters) ? state : { statusFilters }
      }),
      toggleWorkPrFilter: filter => set((state) => {
        const workPrFilters = toggleInList(state.workPrFilters, filter)
        return sameStringList(state.workPrFilters, workPrFilters) ? state : { workPrFilters }
      }),
      toggleEnvironmentFilter: filter => set((state) => {
        const environmentFilters = toggleInList(state.environmentFilters, filter)
        return sameStringList(state.environmentFilters, environmentFilters)
          ? state
          : { environmentFilters }
      }),
      toggleSourceFilter: filter => set((state) => {
        const sourceFilters = toggleInList(state.sourceFilters, filter)
        return sameStringList(state.sourceFilters, sourceFilters) ? state : { sourceFilters }
      }),
      setShowArchived: showArchived => set(state =>
        state.showArchived === showArchived ? state : { showArchived }),
      clearListFilters: () => set(state => (
        listFiltersAreActive(state)
          ? { ...DEFAULT_WORKSPACE_SIDEBAR_LIST_FILTERS }
          : state
      )),
      setSessionPreviewLimit: limit => set((state) => {
        const normalized = normalizeSessionPreviewLimit(limit)
        return state.sessionPreviewLimit === normalized ? state : { sessionPreviewLimit: normalized }
      }),
      setWorkspaceExpanded: (workspaceId, expanded) => set((state) => {
        const collapsedWorkspaceIds = setFlag(state.collapsedWorkspaceIds, workspaceId, !expanded)
        return collapsedWorkspaceIds === state.collapsedWorkspaceIds ? state : { collapsedWorkspaceIds }
      }),
      toggleWorkspaceExpanded: workspaceId => set((state) => {
        const expanded = state.collapsedWorkspaceIds[workspaceId] !== true
        return {
          collapsedWorkspaceIds: setFlag(state.collapsedWorkspaceIds, workspaceId, expanded),
        }
      }),
      collapseAllWorkspaces: workspaceIds => set((state) => {
        let changed = false
        const collapsedWorkspaceIds: WorkspaceSidebarFlagMap = { ...state.collapsedWorkspaceIds }
        for (const workspaceId of workspaceIds) {
          if (!collapsedWorkspaceIds[workspaceId]) {
            collapsedWorkspaceIds[workspaceId] = true
            changed = true
          }
        }
        return changed ? { collapsedWorkspaceIds } : state
      }),
      setWorkspaceSessionListExpanded: (workspaceId, expanded) => set((state) => {
        const expandedSessionListWorkspaceIds = setFlag(state.expandedSessionListWorkspaceIds, workspaceId, expanded)
        return expandedSessionListWorkspaceIds === state.expandedSessionListWorkspaceIds
          ? state
          : { expandedSessionListWorkspaceIds }
      }),
      toggleWorkspaceSessionListExpanded: workspaceId => set((state) => {
        const expanded = state.expandedSessionListWorkspaceIds[workspaceId] !== true
        return {
          expandedSessionListWorkspaceIds: setFlag(state.expandedSessionListWorkspaceIds, workspaceId, expanded),
        }
      }),
      setSessionGroupExpanded: (groupId, expanded) => set((state) => {
        const expandedSessionGroupIds = setFlag(state.expandedSessionGroupIds, groupId, expanded)
        return expandedSessionGroupIds === state.expandedSessionGroupIds ? state : { expandedSessionGroupIds }
      }),
      toggleSessionGroupExpanded: groupId => set((state) => {
        const expanded = state.expandedSessionGroupIds[groupId] !== true
        return {
          expandedSessionGroupIds: setFlag(state.expandedSessionGroupIds, groupId, expanded),
        }
      }),
      pruneWorkspaceSidebarState: workspaceIds => set((state) => {
        const allowedIds = new Set(workspaceIds)
        const collapsedWorkspaceIds = pruneFlags(state.collapsedWorkspaceIds, allowedIds)
        const expandedSessionListWorkspaceIds = pruneFlags(state.expandedSessionListWorkspaceIds, allowedIds)
        if (
          collapsedWorkspaceIds === state.collapsedWorkspaceIds
          && expandedSessionListWorkspaceIds === state.expandedSessionListWorkspaceIds
        ) {
          return state
        }
        return {
          collapsedWorkspaceIds,
          expandedSessionListWorkspaceIds,
        }
      }),
    }),
    {
      name: 'cradle:workspace-sidebar-ui:v1',
      storage: persistStorage,
      version: 4,
      partialize: state => ({
        collapsedWorkspaceIds: state.collapsedWorkspaceIds,
        expandedSessionListWorkspaceIds: state.expandedSessionListWorkspaceIds,
        expandedSessionGroupIds: state.expandedSessionGroupIds,
        sessionPreviewLimit: state.sessionPreviewLimit,
        grouping: state.grouping,
        sessionOrdering: state.sessionOrdering,
        orderingDirection: state.orderingDirection,
        statusFilters: state.statusFilters,
        workPrFilters: state.workPrFilters,
        environmentFilters: state.environmentFilters,
        sourceFilters: state.sourceFilters,
        showArchived: state.showArchived,
      }),
      migrate: (persistedState, version) => {
        const persisted = (persistedState ?? {}) as PersistedWorkspaceSidebarUiState
        if (version >= 4) {
          return persisted
        }

        // v3 → v4: the flat recent-session sort became the `updated` grouping,
        // project sorting collapsed to the session ordering, and scope /
        // pinned-first were dropped without replacement.
        const legacyStatusFilters = migrateLegacyProjectFilterStatusFilters(persisted.projectFilter)
        return {
          collapsedWorkspaceIds: persisted.collapsedWorkspaceIds,
          expandedSessionListWorkspaceIds: persisted.expandedSessionListWorkspaceIds,
          expandedSessionGroupIds: persisted.expandedSessionGroupIds,
          sessionPreviewLimit: persisted.sessionPreviewLimit,
          grouping: persisted.projectSortKey === 'recentSession' ? 'updated' : 'workspace',
          sessionOrdering: persisted.projectSortKey === 'createdAt' ? 'created' : 'updated',
          orderingDirection: persisted.projectSortDirection === 'asc' ? 'asc' : 'desc',
          statusFilters: persisted.statusFilters ?? legacyStatusFilters,
          workPrFilters: persisted.workPrFilters ?? [],
          environmentFilters: [],
          sourceFilters: persisted.sourceFilters ?? [],
          showArchived: persisted.showArchived ?? false,
        }
      },
      merge: (persistedState, currentState) => {
        const persisted = persistedState as PersistedWorkspaceSidebarUiState
        return {
          ...currentState,
          collapsedWorkspaceIds: normalizeFlags(persisted?.collapsedWorkspaceIds),
          expandedSessionListWorkspaceIds: normalizeFlags(persisted?.expandedSessionListWorkspaceIds),
          expandedSessionGroupIds: normalizeFlags(persisted?.expandedSessionGroupIds),
          sessionPreviewLimit: normalizeSessionPreviewLimit(persisted?.sessionPreviewLimit),
          grouping: normalizeGrouping(persisted?.grouping),
          sessionOrdering: normalizeSessionOrdering(persisted?.sessionOrdering),
          orderingDirection: normalizeOrderingDirection(persisted?.orderingDirection),
          statusFilters: normalizeFilterList(persisted?.statusFilters, STATUS_FILTERS),
          workPrFilters: normalizeFilterList(persisted?.workPrFilters, WORK_PR_FILTERS),
          environmentFilters: normalizeFilterList(persisted?.environmentFilters, ENVIRONMENT_FILTERS),
          sourceFilters: normalizeFilterList(persisted?.sourceFilters, SOURCE_FILTERS),
          showArchived: typeof persisted?.showArchived === 'boolean'
            ? persisted.showArchived
            : false,
        }
      },
    },
  ),
)
