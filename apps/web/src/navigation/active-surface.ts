import { useRouterState } from '@tanstack/react-router'

import { router } from '~/router'

import type { SurfaceDraft } from './surface-identity'
import { surfaceDraftFromRoute } from './surface-identity'

interface RouterSurfaceState {
  location: {
    pathname: string
    search?: Record<string, unknown>
    href?: string
  }
  matches: Array<{
    params: Record<string, unknown>
  }>
}

export function surfaceDraftFromRouterState(state: RouterSurfaceState): SurfaceDraft | null {
  const match = state.matches.at(-1)
  return surfaceDraftFromRoute({
    pathname: state.location.pathname,
    params: match?.params,
    search: state.location.search,
  })
}

export function readActiveSurface(): SurfaceDraft | null {
  return surfaceDraftFromRouterState(router.state)
}

export function readActiveSurfaceId(): string | null {
  return readActiveSurface()?.id ?? null
}

export function useActiveSurface(): SurfaceDraft | null {
  return useRouterState({
    router,
    select: state => surfaceDraftFromRouterState(state),
    structuralSharing: true,
  })
}

export function useActiveSurfaceId(): string | null {
  return useRouterState({
    router,
    select: state => surfaceDraftFromRouterState(state)?.id ?? null,
  })
}

export function useIsActiveSurfaceId(surfaceId: string): boolean {
  return useRouterState({
    router,
    select: state => surfaceDraftFromRouterState(state)?.id === surfaceId,
  })
}
