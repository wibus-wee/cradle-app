import { getTerminalLifetimeController } from './terminal-lifetime-controller'
import { useTerminalPanelStore } from './terminal-panel-store'

export function stopTerminalPanelOwner(ownerId: string): void {
  const sessions = useTerminalPanelStore.getState().removeOwner(ownerId)
  const lifetime = getTerminalLifetimeController()

  for (const session of sessions) {
    lifetime.register({
      terminalId: session.id,
      adapterKind: 'bottom-panel',
      ownerId,
    })
    void lifetime.stop(session.id).catch(() => {})
  }
}

export function stopTerminalPanelOwners(ownerIds: Iterable<string>): void {
  for (const ownerId of ownerIds) {
    stopTerminalPanelOwner(ownerId)
  }
}
