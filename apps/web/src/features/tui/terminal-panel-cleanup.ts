import { deleteTerminalSessionsShellByPtyId } from '~/api-gen/sdk.gen'

import { useTerminalPanelStore } from './terminal-panel-store'

export function stopTerminalPanelOwner(ownerId: string): void {
  const sessions = useTerminalPanelStore.getState().removeOwner(ownerId)

  for (const session of sessions) {
    void deleteTerminalSessionsShellByPtyId({
      path: { ptyId: session.id },
    }).catch(() => {})
  }
}

export function stopTerminalPanelOwners(ownerIds: Iterable<string>): void {
  for (const ownerId of ownerIds) {
    stopTerminalPanelOwner(ownerId)
  }
}
