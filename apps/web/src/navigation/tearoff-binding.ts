import type { DehydratedState } from '@tanstack/react-query'
import { hydrate } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'

import { queryClient } from '~/lib/query-client'

import type { SurfaceRoute } from './surface-identity'

export interface TearoffSurfaceBinding {
  surfaceId: string
  route: SurfaceRoute
  bootstrap?: DehydratedState | null
}

const initialRoute = window.cradle?.env?.surfaceRoute as SurfaceRoute | null | undefined
let binding: TearoffSurfaceBinding | null = window.cradle?.env?.surface && initialRoute
  ? { surfaceId: window.cradle.env.surface, route: initialRoute, bootstrap: null }
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
  publish(next as TearoffSurfaceBinding)
})

export function readTearoffSurfaceBinding(): TearoffSurfaceBinding | null {
  return binding
}

/**
 * Present the hidden native window only after the bound React surface reports
 * its own data-ready state. Route navigation alone is not a content-ready
 * signal: lazy chunks and query hydration may still be rendering a fallback.
 */
export function notifyTearoffSurfaceContentReady(): void {
  if (binding) {
    window.cradle?.tearoff?.notifySurfacePresented(binding.surfaceId)
  }
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
