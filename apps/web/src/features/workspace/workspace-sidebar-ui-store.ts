import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { persistStorage } from '~/store/persist-storage'

type WorkspaceSidebarFlagMap = Record<string, true>

export type WorkspaceSidebarProjectSortKey = 'name' | 'updatedAt' | 'createdAt'
export type WorkspaceSidebarProjectSortDirection = 'asc' | 'desc'
export type WorkspaceSidebarProjectFilter = 'all' | 'pinned' | 'unpinned' | 'unread' | 'running' | 'recent'

export const SESSION_PREVIEW_LIMIT_OPTIONS = [3, 5, 8, 10, 15, 20] as const
export const DEFAULT_SESSION_PREVIEW_LIMIT = 5
export const MIN_SESSION_PREVIEW_LIMIT = SESSION_PREVIEW_LIMIT_OPTIONS[0]
export const MAX_SESSION_PREVIEW_LIMIT = SESSION_PREVIEW_LIMIT_OPTIONS.at(-1) ?? DEFAULT_SESSION_PREVIEW_LIMIT

interface WorkspaceSidebarUiState {
  collapsedWorkspaceIds: WorkspaceSidebarFlagMap
  expandedSessionListWorkspaceIds: WorkspaceSidebarFlagMap
  sessionPreviewLimit: number
  projectFilter: WorkspaceSidebarProjectFilter
  projectSortKey: WorkspaceSidebarProjectSortKey
  projectSortDirection: WorkspaceSidebarProjectSortDirection
  projectPinnedFirst: boolean
  setProjectFilter: (filter: WorkspaceSidebarProjectFilter) => void
  setProjectSortKey: (sortKey: WorkspaceSidebarProjectSortKey) => void
  setProjectSortDirection: (sortDirection: WorkspaceSidebarProjectSortDirection) => void
  setProjectPinnedFirst: (pinnedFirst: boolean) => void
  setSessionPreviewLimit: (limit: number) => void
  setWorkspaceExpanded: (workspaceId: string, expanded: boolean) => void
  toggleWorkspaceExpanded: (workspaceId: string) => void
  setWorkspaceSessionListExpanded: (workspaceId: string, expanded: boolean) => void
  toggleWorkspaceSessionListExpanded: (workspaceId: string) => void
  pruneWorkspaceSidebarState: (workspaceIds: readonly string[]) => void
}

interface PersistedWorkspaceSidebarUiState {
  collapsedWorkspaceIds?: WorkspaceSidebarFlagMap
  expandedSessionListWorkspaceIds?: WorkspaceSidebarFlagMap
  sessionPreviewLimit?: unknown
  projectFilter?: unknown
  projectSortKey?: unknown
  projectSortDirection?: unknown
  projectPinnedFirst?: unknown
}

const PROJECT_FILTERS = new Set<WorkspaceSidebarProjectFilter>(['all', 'pinned', 'unpinned', 'unread', 'running', 'recent'])
const PROJECT_SORT_KEYS = new Set<WorkspaceSidebarProjectSortKey>(['name', 'updatedAt', 'createdAt'])
const PROJECT_SORT_DIRECTIONS = new Set<WorkspaceSidebarProjectSortDirection>(['asc', 'desc'])

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

function normalizeProjectFilter(value: unknown): WorkspaceSidebarProjectFilter {
  return typeof value === 'string' && PROJECT_FILTERS.has(value as WorkspaceSidebarProjectFilter)
    ? value as WorkspaceSidebarProjectFilter
    : 'all'
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

export const useWorkspaceSidebarUiStore = create<WorkspaceSidebarUiState>()(
  persist(
    set => ({
      collapsedWorkspaceIds: {},
      expandedSessionListWorkspaceIds: {},
      sessionPreviewLimit: DEFAULT_SESSION_PREVIEW_LIMIT,
      projectFilter: 'all',
      projectSortKey: 'name',
      projectSortDirection: 'asc',
      projectPinnedFirst: true,
      setProjectFilter: projectFilter => set(state => state.projectFilter === projectFilter ? state : { projectFilter }),
      setProjectSortKey: projectSortKey => set(state => state.projectSortKey === projectSortKey ? state : { projectSortKey }),
      setProjectSortDirection: projectSortDirection => set(state => state.projectSortDirection === projectSortDirection ? state : { projectSortDirection }),
      setProjectPinnedFirst: projectPinnedFirst => set(state => state.projectPinnedFirst === projectPinnedFirst ? state : { projectPinnedFirst }),
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
      setWorkspaceSessionListExpanded: (workspaceId, expanded) => set((state) => {
        const expandedSessionListWorkspaceIds = setFlag(state.expandedSessionListWorkspaceIds, workspaceId, expanded)
        return expandedSessionListWorkspaceIds === state.expandedSessionListWorkspaceIds ? state : { expandedSessionListWorkspaceIds }
      }),
      toggleWorkspaceSessionListExpanded: workspaceId => set((state) => {
        const expanded = state.expandedSessionListWorkspaceIds[workspaceId] !== true
        return {
          expandedSessionListWorkspaceIds: setFlag(state.expandedSessionListWorkspaceIds, workspaceId, expanded),
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
      version: 1,
      partialize: state => ({
        collapsedWorkspaceIds: state.collapsedWorkspaceIds,
        expandedSessionListWorkspaceIds: state.expandedSessionListWorkspaceIds,
        sessionPreviewLimit: state.sessionPreviewLimit,
        projectFilter: state.projectFilter,
        projectSortKey: state.projectSortKey,
        projectSortDirection: state.projectSortDirection,
        projectPinnedFirst: state.projectPinnedFirst,
      }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as PersistedWorkspaceSidebarUiState
        return {
          ...currentState,
          collapsedWorkspaceIds: normalizeFlags(persisted?.collapsedWorkspaceIds),
          expandedSessionListWorkspaceIds: normalizeFlags(persisted?.expandedSessionListWorkspaceIds),
          sessionPreviewLimit: normalizeSessionPreviewLimit(persisted?.sessionPreviewLimit),
          projectFilter: normalizeProjectFilter(persisted?.projectFilter),
          projectSortKey: normalizeProjectSortKey(persisted?.projectSortKey),
          projectSortDirection: normalizeProjectSortDirection(persisted?.projectSortDirection),
          projectPinnedFirst: typeof persisted?.projectPinnedFirst === 'boolean' ? persisted.projectPinnedFirst : true,
        }
      },
    },
  ),
)
