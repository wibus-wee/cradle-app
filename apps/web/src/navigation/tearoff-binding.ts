import type { DehydratedState } from '@tanstack/react-query'
import { hydrate } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'

import { queryClient } from '~/lib/query-client'

import type { SurfaceRoute } from './surface-identity'
import { parseSurfaceRoute } from './surface-route-codec'

export interface TearoffSurfaceBinding {
  surfaceId: string
  route: SurfaceRoute
  bootstrap?: DehydratedState | null
}

/**
 * The binding arrives through preload args / IPC, so the route is `unknown`
 * until the surface-route codec validates it. A malformed binding is dropped
 * rather than handed to the router as a navigation target.
 */
function decodeTearoffSurfaceBinding(value: unknown): TearoffSurfaceBinding | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const candidate = value as { surfaceId?: unknown, route?: unknown, bootstrap?: unknown }
  const route = parseSurfaceRoute(candidate.route)
  if (typeof candidate.surfaceId !== 'string' || candidate.surfaceId.length === 0 || !route) {
    return null
  }
  return {
    surfaceId: candidate.surfaceId,
    route,
    bootstrap: (candidate.bootstrap ?? null) as DehydratedState | null,
  }
}

const initialRoute = parseSurfaceRoute(window.cradle?.env?.surfaceRoute)
const initialSurfaceId = window.cradle?.env?.surface
let binding: TearoffSurfaceBinding | null
  = typeof initialSurfaceId === 'string' && initialRoute
    ? { surfaceId: initialSurfaceId, route: initialRoute, bootstrap: null }
    : null
const listeners = new Set<() => void>()

function publish(next: TearoffSurfaceBinding): void {
  if (next.bootstrap) {
    hydrate(queryClient, next.bootstrap)
  }
  binding = next
  for (const listener of listeners) {
    listener()
  }
}

window.cradle?.tearoff?.onSurfaceBound((next) => {
  const decoded = decodeTearoffSurfaceBinding(next)
  if (decoded) {
    publish(decoded)
  }
})

export function readTearoffSurfaceBinding(): TearoffSurfaceBinding | null {
  return binding
}

export function useTearoffSurfaceBinding(): TearoffSurfaceBinding | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    readTearoffSurfaceBinding,
    readTearoffSurfaceBinding,
  )
}
