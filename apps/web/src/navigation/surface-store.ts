import { z } from 'zod'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import { isTearoffWindow } from '~/lib/electron'

import type { AppSurface, SurfaceDraft, SurfaceRoute } from './surface-identity'
import { HOME_SURFACE, HOME_SURFACE_ID, sortSurfaces } from './surface-identity'

const SURFACE_STORAGE_KEY = 'cradle:surfaces:v1'
const LEGACY_TABS_STORAGE_KEY = 'cradle:tabs-next:v1'
const SURFACE_PERSIST_VERSION = 1

interface PersistedSurfaceState {
  surfaces: AppSurface[]
}

type LegacyPersistedSurfaceState = PersistedSurfaceState & {
  activeSurfaceId?: string | null
}

interface SurfaceState extends PersistedSurfaceState {
  syncSurface: (surface: SurfaceDraft) => void
  replaceSurface: (replacedSurfaceId: string | null, surface: SurfaceDraft) => void
  closeSurface: (surfaceId: string) => void
  reorderSurfaces: (orderedIds: string[]) => void
  updateSurfaceTitle: (surfaceId: string, title: string) => void
  resetSurfaces: () => void
}

const optionalStringSchema = z.string().optional()
const diffSearchSchema = z.object({
  workspace: optionalStringSchema,
  repo: optionalStringSchema,
  path: optionalStringSchema,
  review: optionalStringSchema,
  view: z.enum(['commit', 'guide']).optional(),
}).optional()

const surfaceRouteSchema = z.discriminatedUnion('to', [
  z.object({ to: z.literal('/') }),
  z.object({
    to: z.literal('/chat/new'),
    search: z.object({ issueId: optionalStringSchema }).optional(),
  }),
  z.object({
    to: z.literal('/chat/$sessionId'),
    params: z.object({ sessionId: z.string() }),
  }),
  z.object({
    to: z.literal('/diff'),
    search: diffSearchSchema,
  }),
  z.object({
    to: z.literal('/workspaces/$workspaceId'),
    params: z.object({ workspaceId: z.string() }),
  }),
  z.object({
    to: z.literal('/workspaces/$workspaceId/diffs'),
    params: z.object({ workspaceId: z.string() }),
    search: diffSearchSchema,
  }),
  z.object({
    to: z.literal('/kanban/$boardId'),
    params: z.object({ boardId: z.string() }),
    search: z.object({
      issue: optionalStringSchema,
      milestoneId: optionalStringSchema,
    }).optional(),
  }),
  z.object({
    to: z.literal('/plugins/$routeSegment/$localId'),
    params: z.object({ routeSegment: z.string(), localId: z.string() }),
  }),
  z.object({ to: z.literal('/awaits') }),
  z.object({ to: z.literal('/automation') }),
  z.object({ to: z.literal('/usage') }),
  z.object({
    to: z.literal('/settings/$section'),
    params: z.object({ section: z.string() }),
  }),
  z.object({ to: z.literal('/onboarding') }),
  z.object({ to: z.literal('/devtool') }),
]) satisfies z.ZodType<SurfaceRoute>

const appSurfaceSchema = z.object({
  id: z.string().min(1),
  kind: z.enum([
    'home',
    'new-chat',
    'chat',
    'diff',
    'workspace',
    'workspace-diffs',
    'kanban',
    'plugin',
    'awaits',
    'automation',
    'usage',
    'settings',
    'onboarding',
    'devtool',
  ]),
  title: z.string(),
  route: surfaceRouteSchema,
  order: z.number().finite(),
  closable: z.boolean(),
}) satisfies z.ZodType<AppSurface>

const persistedSurfaceStateSchema = z.object({
  surfaces: z.array(z.unknown()).optional(),
})

export function readPersistedSurfaceState(raw: unknown): PersistedSurfaceState {
  const parsedState = persistedSurfaceStateSchema.safeParse(raw)
  if (!parsedState.success) {
    return { surfaces: [HOME_SURFACE] }
  }

  const surfaces = (parsedState.data.surfaces ?? [])
    .map(surface => appSurfaceSchema.safeParse(surface))
    .filter(result => result.success)
    .map(result => result.data)

  return {
    surfaces: normalizeSurfaces(surfaces.length > 0 ? surfaces : [HOME_SURFACE]),
  }
}

function normalizeSurfaces(surfaces: readonly AppSurface[]): AppSurface[] {
  const byId = new Map<string, AppSurface>()
  for (const surface of surfaces) {
    if (surface.kind === 'settings') {
      continue
    }
    byId.set(surface.id, surface)
  }
  byId.set(HOME_SURFACE_ID, {
    ...HOME_SURFACE,
    ...(byId.get(HOME_SURFACE_ID) ?? {}),
    id: HOME_SURFACE_ID,
    kind: 'home',
    route: HOME_SURFACE.route,
    closable: false,
  })

  return sortSurfaces(Array.from(byId.values())).map((surface, index) => ({
    ...surface,
    order: index,
  }))
}

function routeRecordsEqual(
  left: Record<string, string | undefined> | undefined,
  right: Record<string, string | undefined> | undefined,
): boolean {
  if (left === right) {
    return true
  }
  if (!left || !right) {
    return false
  }

  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  return leftKeys.length === rightKeys.length && leftKeys.every(key => left[key] === right[key])
}

function routesEqual(left: SurfaceRoute, right: SurfaceRoute): boolean {
  return (
    left.to === right.to
    && routeRecordsEqual(left.params, right.params)
    && routeRecordsEqual(left.search, right.search)
  )
}

function surfaceMatchesDraft(existing: AppSurface, surface: SurfaceDraft): boolean {
  return (
    existing.kind === surface.kind
    && existing.title === (existing.title || surface.title)
    && routesEqual(existing.route, surface.route)
    && existing.closable === surface.closable
  )
}

function appendOrUpdateSurface(
  surfaces: readonly AppSurface[],
  surface: SurfaceDraft,
): AppSurface[] {
  const existing = surfaces.find(item => item.id === surface.id)
  if (!existing) {
    return normalizeSurfaces([
      ...surfaces,
      {
        ...surface,
        order: surfaces.length,
      },
    ])
  }

  if (surfaceMatchesDraft(existing, surface)) {
    return surfaces as AppSurface[]
  }

  return normalizeSurfaces(
    surfaces.map(item =>
      item.id === surface.id
        ? {
            ...item,
            kind: surface.kind,
            title: item.title || surface.title,
            route: surface.route,
            closable: surface.closable,
          }
        : item),
  )
}

function mergeSurface(existing: AppSurface, surface: SurfaceDraft): AppSurface {
  const merged = {
    ...existing,
    kind: surface.kind,
    title: existing.title || surface.title,
    route: surface.route,
    closable: surface.closable,
  }
  return surfaceMatchesDraft(existing, surface) ? existing : merged
}

function replaceSurfaceInCollection(
  surfaces: readonly AppSurface[],
  replacedSurfaceId: string | null,
  surface: SurfaceDraft,
): AppSurface[] {
  const replacedSurface = surfaces.find(item => item.id === replacedSurfaceId)
  if (!replacedSurface || !replacedSurface.closable) {
    return appendOrUpdateSurface(surfaces, surface)
  }

  const existingTarget = surfaces.find(item => item.id === surface.id)
  if (existingTarget) {
    if (existingTarget.id === replacedSurface.id) {
      const merged = mergeSurface(existingTarget, surface)
      if (merged === existingTarget) {
        return surfaces as AppSurface[]
      }
      return normalizeSurfaces(
        surfaces.map(item => (item.id === surface.id ? merged : item)),
      )
    }

    return normalizeSurfaces(
      surfaces
        .filter(item => item.id !== replacedSurface.id || item.id === surface.id)
        .map(item => (item.id === surface.id ? mergeSurface(item, surface) : item)),
    )
  }

  return normalizeSurfaces(
    surfaces.map(item =>
      item.id === replacedSurface.id
        ? {
            ...surface,
            order: replacedSurface.order,
          }
        : item),
  )
}

function clearLegacyTabsPersistence(): void {
  try {
    window.localStorage.removeItem(LEGACY_TABS_STORAGE_KEY)
  }
  catch {}
}

export const useSurfaceStore = create<SurfaceState>()(
  persist(
    set => ({
      surfaces: [HOME_SURFACE],

      syncSurface: surface =>
        set((state) => {
          const surfaces = appendOrUpdateSurface(state.surfaces, surface)
          if (surfaces === state.surfaces) {
            return state
          }
          return { surfaces }
        }),

      replaceSurface: (replacedSurfaceId, surface) =>
        set((state) => {
          const surfaces = replaceSurfaceInCollection(state.surfaces, replacedSurfaceId, surface)
          if (surfaces === state.surfaces) {
            return state
          }
          return { surfaces }
        }),

      closeSurface: surfaceId =>
        set((state) => {
          const target = state.surfaces.find(surface => surface.id === surfaceId)
          if (!target || !target.closable) {
            return state
          }

          const nextSurfaces = normalizeSurfaces(
            state.surfaces.filter(surface => surface.id !== surfaceId),
          )
          return { surfaces: nextSurfaces }
        }),

      reorderSurfaces: orderedIds =>
        set((state) => {
          const rank = new Map(orderedIds.map((id, index) => [id, index]))
          const surfaces = normalizeSurfaces(
            [...state.surfaces].sort((left, right) => {
              const leftRank = rank.get(left.id) ?? Number.MAX_SAFE_INTEGER
              const rightRank = rank.get(right.id) ?? Number.MAX_SAFE_INTEGER
              return leftRank - rightRank || left.order - right.order
            }),
          )
          const unchanged
            = surfaces.length === state.surfaces.length
              && surfaces.every((surface, index) => surface.id === state.surfaces[index]?.id)
          return unchanged ? state : { surfaces }
        }),

      updateSurfaceTitle: (surfaceId, title) =>
        set((state) => {
          if (!title) {
            return state
          }
          const target = state.surfaces.find(surface => surface.id === surfaceId)
          if (!target || target.title === title) {
            return state
          }
          return {
            surfaces: state.surfaces.map(surface =>
              surface.id === surfaceId ? { ...surface, title } : surface),
          }
        }),

      resetSurfaces: () =>
        set((state) => {
          if (
            state.surfaces.length === 1
            && state.surfaces[0]?.id === HOME_SURFACE_ID
          ) {
            return state
          }
          return { surfaces: [HOME_SURFACE] }
        }),
    }),
    {
      name: SURFACE_STORAGE_KEY,
      storage: createJSONStorage(() => (isTearoffWindow ? sessionStorage : localStorage)),
      version: SURFACE_PERSIST_VERSION,
      migrate: persistedState => readPersistedSurfaceState(persistedState),
      partialize: (state): PersistedSurfaceState => ({
        surfaces: normalizeSurfaces(state.surfaces),
      }),
      merge: (persistedState, currentState): SurfaceState => ({
        ...currentState,
        ...readPersistedSurfaceState(persistedState),
      }),
      onRehydrateStorage: () => (state) => {
        clearLegacyTabsPersistence()
        if (!state) {
          return
        }
        delete (state as LegacyPersistedSurfaceState).activeSurfaceId
        state.surfaces = normalizeSurfaces(state.surfaces)
      },
    },
  ),
)

export function readSurface(surfaceId: string): AppSurface | null {
  return useSurfaceStore.getState().surfaces.find(surface => surface.id === surfaceId) ?? null
}
