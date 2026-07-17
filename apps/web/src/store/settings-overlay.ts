import { create } from 'zustand'

export interface ChronicleFocusTarget {
  type: 'memory' | 'knowledge'
  id: string
}

export interface AgentFocusTarget {
  id: string
}

export interface AgentCreateIntent {
  runtimeKind: string
  acpAgentId?: string
}

interface SettingsOverlayState {
  settingsSection: string
  settingsReturnSurfaceId: string | null
  chronicleFocusTarget: ChronicleFocusTarget | null
  agentFocusTarget: AgentFocusTarget | null
  agentCreateIntent: AgentCreateIntent | null
  setSettingsSection: (section: string) => void
  setSettingsReturnSurfaceId: (surfaceId: string | null) => void
  setChronicleFocusTarget: (target: ChronicleFocusTarget | null) => void
  clearChronicleFocusTarget: () => void
  setAgentFocusTarget: (target: AgentFocusTarget | null) => void
  clearAgentFocusTarget: () => void
  setAgentCreateIntent: (intent: AgentCreateIntent | null) => void
  clearAgentCreateIntent: () => void
}

export const useSettingsOverlayStore = create<SettingsOverlayState>()(set => ({
  settingsSection: 'appearance',
  settingsReturnSurfaceId: null,
  chronicleFocusTarget: null,
  agentFocusTarget: null,
  agentCreateIntent: null,
  setSettingsSection: settingsSection => set({ settingsSection }),
  setSettingsReturnSurfaceId: settingsReturnSurfaceId => set({ settingsReturnSurfaceId }),
  setChronicleFocusTarget: chronicleFocusTarget => set({ chronicleFocusTarget }),
  clearChronicleFocusTarget: () => set({ chronicleFocusTarget: null }),
  setAgentFocusTarget: agentFocusTarget => set({ agentFocusTarget }),
  clearAgentFocusTarget: () => set({ agentFocusTarget: null }),
  setAgentCreateIntent: agentCreateIntent => set({ agentCreateIntent }),
  clearAgentCreateIntent: () => set({ agentCreateIntent: null }),
}))
