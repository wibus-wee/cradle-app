import type { PluginLayerState, PluginLayerStatus } from '@cradle/plugin-sdk'
import type { CommandRegistration, PanelRegistration } from '@cradle/plugin-sdk/web'
import { create } from 'zustand'

export type WebPanelRegistration = PanelRegistration & {
  id: string
  localId: string
  owner: string
  routeSegment: string
  registeredAt: string
}

export type WebCommandRegistration = CommandRegistration & {
  id: string
  localId: string
  owner: string
  registeredAt: string
}

interface PluginStoreState {
  panels: WebPanelRegistration[]
  commands: WebCommandRegistration[]
  webLayerStates: Record<string, PluginLayerState>
}

interface PluginStoreActions {
  registerPanel: (owner: string, routeSegment: string, panel: PanelRegistration) => () => void
  registerCommand: (owner: string, cmd: CommandRegistration) => () => void
  setWebLayerState: (owner: string, status: PluginLayerStatus, error?: string) => void
  clearWebLayerState: (owner: string) => void
}

function toScopedContributionId(owner: string, localId: string): string {
  return localId.startsWith(`${owner}:`) ? localId : `${owner}:${localId}`
}

function toLocalContributionId(owner: string, id: string): string {
  return id.startsWith(`${owner}:`) ? id.slice(owner.length + 1) : id
}

export const usePluginStore = create<PluginStoreState & PluginStoreActions>(set => ({
  panels: [],
  commands: [],
  webLayerStates: {},
  setWebLayerState(owner, status, error) {
    set(s => ({
      webLayerStates: {
        ...s.webLayerStates,
        [owner]: {
          ...s.webLayerStates[owner],
          layer: 'web',
          status,
          error,
          activatedAt: status === 'active' ? new Date().toISOString() : undefined,
        },
      },
    }))
  },
  clearWebLayerState(owner) {
    set((s) => {
      const { [owner]: _removed, ...webLayerStates } = s.webLayerStates
      return { webLayerStates }
    })
  },
  registerPanel(owner, routeSegment, panel) {
    const localId = toLocalContributionId(owner, panel.id)
    const id = toScopedContributionId(owner, localId)
    const registeredPanel: WebPanelRegistration = {
      ...panel,
      id,
      localId,
      owner,
      routeSegment,
      registeredAt: new Date().toISOString(),
    }

    set((s) => {
      if (s.panels.some(existing => existing.id === id)) {
        throw new Error(`Duplicate web panel id "${localId}" registered by ${owner}.`)
      }
      return {
        panels: [...s.panels, registeredPanel].toSorted((a, b) => {
          const locationOrder = (a.location ?? 'main').localeCompare(b.location ?? 'main')
          if (locationOrder !== 0) { return locationOrder }
          const orderDelta = (a.order ?? 0) - (b.order ?? 0)
          if (orderDelta !== 0) { return orderDelta }
          return a.id.localeCompare(b.id)
        }),
      }
    })

    return () => set(s => ({ panels: s.panels.filter(p => p.id !== id) }))
  },
  registerCommand(owner, cmd) {
    const localId = toLocalContributionId(owner, cmd.id)
    const id = toScopedContributionId(owner, localId)
    const registeredCommand: WebCommandRegistration = {
      ...cmd,
      id,
      localId,
      owner,
      registeredAt: new Date().toISOString(),
    }

    set((s) => {
      if (s.commands.some(existing => existing.id === id)) {
        throw new Error(`Duplicate web command id "${localId}" registered by ${owner}.`)
      }
      return {
        commands: [...s.commands, registeredCommand].toSorted((a, b) => a.id.localeCompare(b.id)),
      }
    })

    return () => set(s => ({ commands: s.commands.filter(c => c.id !== id) }))
  },
}))
