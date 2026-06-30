import { readActiveSurface as readRouterActiveSurface } from '~/navigation/active-surface'

import type { ContextEnvelope, ContextItem } from './context-items'

export interface ContextProviderInput {
  activeSurfaceId: string | null
  activeSurfaceType: string | null
  activeSurfaceParams: Record<string, string | undefined>
  activeSurfaceSearch: Record<string, string | undefined>
  now: number
}

export interface ContextProvider {
  owner: string
  readContext: (input: ContextProviderInput) => ContextItem[]
}

export interface ContextProviderRegistration {
  owner: string
  dispose: () => void
}

export interface ContextRegistry {
  setProvider: (provider: ContextProvider) => ContextProviderRegistration
  collectEnvelope: () => ContextEnvelope
}

export interface ContextRegistryOptions {
  readActiveSurface?: () => {
    id: string | null
    type: string | null
    params?: Record<string, string | undefined>
    search?: Record<string, string | undefined>
  }
  createEnvelopeId?: (now: number) => string
  readNow?: () => number
}

function defaultEnvelopeId(now: number): string {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)
  return `ctx-${now}-${random}`
}

function surfaceKindToContextType(kind: string): string {
  if (kind === 'workspace') {
    return 'workspace-detail'
  }
  if (kind === 'kanban') {
    return 'kanban-board'
  }
  if (kind === 'plugin') {
    return 'plugin-panel'
  }
  return kind
}

function readCradleActiveSurface(): {
  id: string | null
  type: string | null
  params: Record<string, string | undefined>
  search: Record<string, string | undefined>
} {
  const activeSurface = readRouterActiveSurface()

  return {
    id: activeSurface?.id ?? null,
    type: activeSurface ? surfaceKindToContextType(activeSurface.kind) : null,
    params: activeSurface?.route.params ?? {},
    search: activeSurface?.route.search ?? {},
  }
}

export function createContextRegistry(options: ContextRegistryOptions = {}): ContextRegistry {
  const providerSlots = new Map<string, { generation: number, provider: ContextProvider }>()
  const readActiveSurface = options.readActiveSurface ?? readCradleActiveSurface
  const readNow = options.readNow ?? Date.now
  const createEnvelopeId = options.createEnvelopeId ?? defaultEnvelopeId
  let nextGeneration = 0

  return {
    setProvider(provider) {
      const generation = nextGeneration + 1
      nextGeneration = generation
      providerSlots.set(provider.owner, { generation, provider })

      return {
        owner: provider.owner,
        dispose() {
          const slot = providerSlots.get(provider.owner)
          if (slot?.generation === generation) {
            providerSlots.delete(provider.owner)
          }
        },
      }
    },

    collectEnvelope() {
      const now = readNow()
      const activeSurface = readActiveSurface()
      const input: ContextProviderInput = {
        activeSurfaceId: activeSurface.id,
        activeSurfaceType: activeSurface.type,
        activeSurfaceParams: activeSurface.params ?? {},
        activeSurfaceSearch: activeSurface.search ?? {},
        now,
      }
      const items = [...providerSlots.values()].flatMap(slot => slot.provider.readContext(input))

      return {
        id: createEnvelopeId(now),
        capturedAt: now,
        activeSurfaceId: activeSurface.id,
        activeSurfaceType: activeSurface.type,
        activeSurfaceParams: activeSurface.params ?? {},
        activeSurfaceSearch: activeSurface.search ?? {},
        items,
      }
    },
  }
}

export function installContextProviders(
  providers: ContextProvider[],
  registry: ContextRegistry = rendererContextRegistry,
): () => void {
  const owners = new Set<string>()
  for (const provider of providers) {
    if (owners.has(provider.owner)) {
      throw new Error(`Duplicate context provider owner: ${provider.owner}`)
    }
    owners.add(provider.owner)
  }

  const registrations = providers.map(provider => registry.setProvider(provider))

  return () => {
    for (let index = registrations.length - 1; index >= 0; index -= 1) {
      registrations[index].dispose()
    }
  }
}

export const rendererContextRegistry = createContextRegistry()
