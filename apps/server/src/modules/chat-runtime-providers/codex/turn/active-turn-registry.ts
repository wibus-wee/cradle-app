import type { ActiveCodexTurn } from '../types'

interface RegisteredCodexTurn {
  entry: ActiveCodexTurn
  startedTurn: PromiseWithResolvers<string | null>
}

export class CodexActiveTurnRegistry {
  private readonly entries = new Map<string, RegisteredCodexTurn>()

  register(sessionId: string, entry: ActiveCodexTurn): ActiveCodexTurn {
    this.entries.get(sessionId)?.startedTurn.resolve(null)
    this.entries.set(sessionId, {
      entry,
      startedTurn: Promise.withResolvers<string | null>(),
    })
    return entry
  }

  read(sessionId: string): ActiveCodexTurn | null {
    return this.entries.get(sessionId)?.entry ?? null
  }

  markStarted(sessionId: string, entry: ActiveCodexTurn, turnId: string): boolean {
    const registered = this.entries.get(sessionId)
    if (registered?.entry !== entry) {
      return false
    }
    entry.turnId = turnId
    registered.startedTurn.resolve(turnId)
    return true
  }

  markCompleted(sessionId: string, entry: ActiveCodexTurn, turnId: string | null): boolean {
    const registered = this.entries.get(sessionId)
    if (registered?.entry !== entry || !entry.turnId || (turnId && entry.turnId !== turnId)) {
      return false
    }
    entry.turnId = null
    registered.startedTurn = Promise.withResolvers<string | null>()
    return true
  }

  async waitForStartedTurn(sessionId: string, entry: ActiveCodexTurn): Promise<string | null> {
    while (true) {
      const registered = this.entries.get(sessionId)
      if (registered?.entry !== entry) {
        return null
      }
      if (entry.turnId) {
        return entry.turnId
      }
      const turnId = await registered.startedTurn.promise
      if (!turnId) {
        return null
      }
      if (this.entries.get(sessionId) === registered && entry.turnId === turnId) {
        return turnId
      }
    }
  }

  /**
   * Drop map ownership without releasing the host lease. Cancel uses this so a
   * concurrent streamTurn can register while interrupt still holds the lease.
   */
  detach(sessionId: string, entry: ActiveCodexTurn): boolean {
    const registered = this.entries.get(sessionId)
    if (registered?.entry !== entry) {
      return false
    }
    this.entries.delete(sessionId)
    registered.startedTurn.resolve(null)
    return true
  }

  release(sessionId: string, entry: ActiveCodexTurn): boolean {
    if (!this.detach(sessionId, entry)) {
      return false
    }
    entry.hostLease.release()
    return true
  }
}
