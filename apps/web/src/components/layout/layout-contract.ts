import type { ReactNode } from 'react'

import type { SessionLayoutRecord } from '~/components/layout/layout-records'

import type { LayoutSlots } from './layout-slots-context'

interface ActiveLayoutTab {
  type: string
  label: string
  params: Record<string, string | undefined>
}

export interface ActiveLayoutContract {
  asideSessionId: string | null
  asideWorkspaceId: string | null
  hasAside: boolean | undefined
  hasBrowserPanel: boolean | undefined
  hasPanel: boolean | undefined
  panel: ReactNode | undefined
}

export interface ActiveLayoutContractInput {
  activeTab: ActiveLayoutTab | undefined
  slots: LayoutSlots
  sessionLayout: SessionLayoutRecord | undefined
  explicitPanel: ReactNode | undefined
  explicitHasBrowserPanel: boolean | undefined
  explicitHasPanel: boolean | undefined
}

function deriveCapability(
  routeCapability: boolean,
  slotCapability: boolean | undefined,
  explicitCapability: boolean | undefined,
): boolean | undefined {
  return routeCapability || (slotCapability ?? explicitCapability)
}

export function deriveActiveLayoutContract({
  activeTab,
  slots,
  sessionLayout,
  explicitPanel,
  explicitHasBrowserPanel,
  explicitHasPanel,
}: ActiveLayoutContractInput): ActiveLayoutContract {
  if (activeTab?.type === 'chat') {
    const sessionId = activeTab.params.sessionId ?? null
    const activeSlots = sessionId && slots.asideSessionId === sessionId ? slots : {}
    const workspaceId = sessionLayout?.workspaceId ?? activeSlots.asideWorkspaceId ?? null
    const hasWorkspace = !!workspaceId

    return {
      asideSessionId: sessionId,
      asideWorkspaceId: workspaceId,
      hasAside: true,
      hasBrowserPanel: deriveCapability(hasWorkspace, activeSlots.hasBrowserPanel, explicitHasBrowserPanel),
      hasPanel: deriveCapability(hasWorkspace, activeSlots.hasPanel, explicitHasPanel),
      panel: activeSlots.panel ?? explicitPanel,
    }
  }

  if (activeTab?.type === 'workspace-detail') {
    const workspaceId = activeTab.params.workspaceId ?? null
    const activeSlots = workspaceId && slots.asideWorkspaceId === workspaceId ? slots : {}

    return {
      asideSessionId: null,
      asideWorkspaceId: workspaceId,
      hasAside: !!workspaceId,
      hasBrowserPanel: deriveCapability(!!workspaceId, activeSlots.hasBrowserPanel, explicitHasBrowserPanel),
      hasPanel: deriveCapability(!!workspaceId, activeSlots.hasPanel, explicitHasPanel),
      panel: activeSlots.panel ?? explicitPanel,
    }
  }

  if (activeTab?.type === 'new-chat') {
    const activeSlots = !slots.asideSessionId ? slots : {}

    return {
      asideSessionId: null,
      asideWorkspaceId: activeSlots.asideWorkspaceId ?? null,
      hasAside: activeSlots.hasAside,
      hasBrowserPanel: activeSlots.hasBrowserPanel ?? explicitHasBrowserPanel,
      hasPanel: activeSlots.hasPanel ?? explicitHasPanel,
      panel: activeSlots.panel ?? explicitPanel,
    }
  }

  return {
    asideSessionId: slots.asideSessionId ?? null,
    asideWorkspaceId: slots.asideWorkspaceId ?? null,
    hasAside: slots.hasAside,
    hasBrowserPanel: slots.hasBrowserPanel ?? explicitHasBrowserPanel,
    hasPanel: slots.hasPanel ?? explicitHasPanel,
    panel: slots.panel ?? explicitPanel,
  }
}
