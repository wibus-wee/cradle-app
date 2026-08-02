import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { persistStorage } from '~/store/persist-storage'

type WorkspaceSidebarFlagMap = Record<string, true>

export type WorkspaceSidebarProjectSortKey
  = 'name' | 'updatedAt' | 'createdAt' | 'recentSession'
export type WorkspaceSidebarProjectSortDirection = 'asc' | 'desc'

export type WorkspaceSidebarProjectScope = 'all' | 'pinned'
export type WorkspaceSidebarStatusFilter = 'unread' | 'streaming' | 'error' | 'needsYou'
export type WorkspaceSidebarWorkPrFilter = 'work' | 'draft' | 'ready' | 'merged'
export type WorkspaceSidebarSourceFilter = 'chat' | 'work' | 'automation' | 'review'

/** @deprecated Prefer the facet model. Kept for migrate-from-v2 only. */
export type WorkspaceSidebarProjectFilter
  = | 'all'
    | 'pinned'
    | 'unpinned'
    | 'unread'
    | 'running'
    | 'recent'

export const SESSION_PREVIEW_LIMIT_OPTIONS = [3, 5, 8, 10, 15, 20] as const
export const DEFAULT_SESSION_PREVIEW_LIMIT = 5
export const MIN_SESSION_PREVIEW_LIMIT = SESSION_PREVIEW_LIMIT_OPTIONS[0]
export const MAX_SESSION_PREVIEW_LIMIT = SESSION_PREVIEW_LIMIT_OPTIONS.at(-1) ?? DEFAULT_SESSION_PREVIEW_LIMIT

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

export const WORKSPACE_SIDEBAR_SOURCE_FILTERS = [
  'chat',
  'work',
  'automation',
  'review',
] as const satisfies readonly WorkspaceSidebarSourceFilter[]

export interface WorkspaceSidebarListFilters {
  projectScope: WorkspaceSidebarProjectScope
  statusFilters: WorkspaceSidebarStatusFilter[]
  workPrFilters: WorkspaceSidebarWorkPrFilter[]
  sourceFilters: WorkspaceSidebarSourceFilter[]
  showArchived: boolean
}

export const DEFAULT_WORKSPACE_SIDEBAR_LIST_FILTERS: WorkspaceSidebarListFilters = {
  projectScope: 'all',
  statusFilters: [],
  workPrFilters: [],
  sourceFilters: [],
  showArchived: false,
}

interface WorkspaceSidebarUiState {
  collapsedWorkspaceIds: WorkspaceSidebarFlagMap
  expandedSessionListWorkspaceIds: WorkspaceSidebarFlagMap
  expandedSessionGroupIds: WorkspaceSidebarFlagMap
  sessionPreviewLimit: number
  projectScope: WorkspaceSidebarProjectScope
  statusFilters: WorkspaceSidebarStatusFilter[]
  workPrFilters: WorkspaceSidebarWorkPrFilter[]
  sourceFilters: WorkspaceSidebarSourceFilter[]
  showArchived: boolean
  projectSortKey: WorkspaceSidebarProjectSortKey
  projectSortDirection: WorkspaceSidebarProjectSortDirection
  projectPinnedFirst: boolean
  setProjectScope: (scope: WorkspaceSidebarProjectScope) => void
  toggleStatusFilter: (filter: WorkspaceSidebarStatusFilter) => void
  toggleWorkPrFilter: (filter: WorkspaceSidebarWorkPrFilter) => void
  toggleSourceFilter: (filter: WorkspaceSidebarSourceFilter) => void
  setShowArchived: (showArchived: boolean) => void
  clearListFilters: () => void
  setProjectSortKey: (sortKey: WorkspaceSidebarProjectSortKey) => void
  setProjectSortDirection: (sortDirection: WorkspaceSidebarProjectSortDirection) => void
  setProjectPinnedFirst: (pinnedFirst: boolean) => void
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
  projectFilter?: unknown
  projectScope?: unknown
  statusFilters?: unknown
  workPrFilters?: unknown
  sourceFilters?: unknown
  showArchived?: unknown
  projectSortKey?: unknown
  projectSortDirection?: unknown
  projectPinnedFirst?: unknown
}

const PROJECT_SCOPES = new Set<WorkspaceSidebarProjectScope>(['all', 'pinned'])
const STATUS_FILTERS = new Set<WorkspaceSidebarStatusFilter>(WORKSPACE_SIDEBAR_STATUS_FILTERS)
const WORK_PR_FILTERS = new Set<WorkspaceSidebarWorkPrFilter>(WORKSPACE_SIDEBAR_WORK_PR_FILTERS)
const SOURCE_FILTERS = new Set<WorkspaceSidebarSourceFilter>(WORKSPACE_SIDEBAR_SOURCE_FILTERS)
const PROJECT_SORT_KEYS = new Set<WorkspaceSidebarProjectSortKey>([
  'name',
  'updatedAt',
  'createdAt',
  'recentSession',
])
const PROJECT_SORT_DIRECTIONS = new Set<WorkspaceSidebarProjectSortDirection>(['asc', 'desc'])
const LEGACY_PROJECT_FILTERS = new Set<WorkspaceSidebarProjectFilter>([
  'all',
  'pinned',
  'unpinned',
  'unread',
  'running',
  'recent',
])

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

function normalizeProjectScope(value: unknown): WorkspaceSidebarProjectScope {
  return typeof value === 'string' && PROJECT_SCOPES.has(value as WorkspaceSidebarProjectScope)
    ? value as WorkspaceSidebarProjectScope
    : 'all'
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

function normalizeProjectSortKey(value: unknown): WorkspaceSidebarProjectSortKey {
  return typeof value === 'string' && PROJECT_SORT_KEYS.has(value as WorkspaceSidebarProjectSortKey)
    ? value as WorkspaceSidebarProjectSortKey
    : 'name'
}

function normalizeProjectSortDirection(value: unknown): WorkspaceSidebarProjectSortDirection {
  return typeof value === 'string' && PROJECT_SORT_DIRECTIONS.has(value as WorkspaceSidebarProjectSortDirection)
    ? value as WorkspaceSidebarProjectSortDirection
    : 'asc'
}

function normalizeSessionPreviewLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_SESSION_PREVIEW_LIMIT
  }
  const clamped = Math.min(Math.max(Math.round(value), MIN_SESSION_PREVIEW_LIMIT), MAX_SESSION_PREVIEW_LIMIT)
  return clamped
}

function migrateLegacyProjectFilter(value: unknown): Partial<WorkspaceSidebarListFilters> {
  if (typeof value !== 'string' || !LEGACY_PROJECT_FILTERS.has(value as WorkspaceSidebarProjectFilter)) {
    return {}
  }

  switch (value as WorkspaceSidebarProjectFilter) {
    case 'pinned':
      return { projectScope: 'pinned' }
    case 'unread':
      return { statusFilters: ['unread'] }
    case 'running':
      return { statusFilters: ['streaming'] }
    case 'unpinned':
    case 'all':
    case 'recent':
      return {}
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
  return filters.projectScope !== 'all'
    || filters.statusFilters.length > 0
    || filters.workPrFilters.length > 0
    || filters.sourceFilters.length > 0
    || filters.showArchived
}

export function rowFiltersAreActive(filters: WorkspaceSidebarListFilters): boolean {
  return filters.statusFilters.length > 0
    || filters.workPrFilters.length > 0
    || filters.sourceFilters.length > 0
}

export const useWorkspaceSidebarUiStore = create<WorkspaceSidebarUiState>()(
  persist(
    set => ({
      collapsedWorkspaceIds: {},
      expandedSessionListWorkspaceIds: {},
      expandedSessionGroupIds: {},
      sessionPreviewLimit: DEFAULT_SESSION_PREVIEW_LIMIT,
      ...DEFAULT_WORKSPACE_SIDEBAR_LIST_FILTERS,
      projectSortKey: 'name',
      projectSortDirection: 'asc',
      projectPinnedFirst: true,
      setProjectScope: projectScope => set(state =>
        state.projectScope === projectScope ? state : { projectScope }),
      toggleStatusFilter: filter => set((state) => {
        const statusFilters = toggleInList(state.statusFilters, filter)
        return sameStringList(state.statusFilters, statusFilters) ? state : { statusFilters }
      }),
      toggleWorkPrFilter: filter => set((state) => {
        const workPrFilters = toggleInList(state.workPrFilters, filter)
        return sameStringList(state.workPrFilters, workPrFilters) ? state : { workPrFilters }
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
      setProjectSortKey: projectSortKey => set(state =>
        state.projectSortKey === projectSortKey ? state : { projectSortKey }),
      setProjectSortDirection: projectSortDirection => set(state =>
        state.projectSortDirection === projectSortDirection ? state : { projectSortDirection }),
      setProjectPinnedFirst: projectPinnedFirst => set(state =>
        state.projectPinnedFirst === projectPinnedFirst ? state : { projectPinnedFirst }),
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
      version: 3,
      partialize: state => ({
        collapsedWorkspaceIds: state.collapsedWorkspaceIds,
        expandedSessionListWorkspaceIds: state.expandedSessionListWorkspaceIds,
        expandedSessionGroupIds: state.expandedSessionGroupIds,
        sessionPreviewLimit: state.sessionPreviewLimit,
        projectScope: state.projectScope,
        statusFilters: state.statusFilters,
        workPrFilters: state.workPrFilters,
        sourceFilters: state.sourceFilters,
        showArchived: state.showArchived,
        projectSortKey: state.projectSortKey,
        projectSortDirection: state.projectSortDirection,
        projectPinnedFirst: state.projectPinnedFirst,
      }),
      migrate: (persistedState, version) => {
        const persisted = (persistedState ?? {}) as PersistedWorkspaceSidebarUiState
        if (version >= 3) {
          return persisted
        }

        const legacy = migrateLegacyProjectFilter(persisted.projectFilter)
        return {
          ...persisted,
          projectScope: persisted.projectScope ?? legacy.projectScope ?? 'all',
          statusFilters: persisted.statusFilters ?? legacy.statusFilters ?? [],
          workPrFilters: persisted.workPrFilters ?? [],
          sourceFilters: persisted.sourceFilters ?? [],
          showArchived: persisted.showArchived ?? false,
        }
      },
      merge: (persistedState, currentState) => {
        const persisted = persistedState as PersistedWorkspaceSidebarUiState
        const legacy = migrateLegacyProjectFilter(persisted?.projectFilter)
        return {
          ...currentState,
          collapsedWorkspaceIds: normalizeFlags(persisted?.collapsedWorkspaceIds),
          expandedSessionListWorkspaceIds: normalizeFlags(persisted?.expandedSessionListWorkspaceIds),
          expandedSessionGroupIds: normalizeFlags(persisted?.expandedSessionGroupIds),
          sessionPreviewLimit: normalizeSessionPreviewLimit(persisted?.sessionPreviewLimit),
          projectScope: normalizeProjectScope(persisted?.projectScope ?? legacy.projectScope),
          statusFilters: normalizeFilterList(
            persisted?.statusFilters ?? legacy.statusFilters,
            STATUS_FILTERS,
          ),
          workPrFilters: normalizeFilterList(persisted?.workPrFilters, WORK_PR_FILTERS),
          sourceFilters: normalizeFilterList(persisted?.sourceFilters, SOURCE_FILTERS),
          showArchived: typeof persisted?.showArchived === 'boolean'
            ? persisted.showArchived
            : false,
          projectSortKey: normalizeProjectSortKey(persisted?.projectSortKey),
          projectSortDirection: normalizeProjectSortDirection(persisted?.projectSortDirection),
          projectPinnedFirst: typeof persisted?.projectPinnedFirst === 'boolean'
            ? persisted.projectPinnedFirst
            : true,
        }
      },
    },
  ),
)
