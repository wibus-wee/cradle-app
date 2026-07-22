import type { ActiveCodexTurn } from '../types'

export class CodexActiveTurnRegistry {
  private readonly entries = new Map<string, ActiveCodexTurn>()

  register(sessionId: string, entry: ActiveCodexTurn): ActiveCodexTurn {
    this.entries.set(sessionId, entry)
    return entry
  }

  read(sessionId: string): ActiveCodexTurn | null {
    return this.entries.get(sessionId) ?? null
  }

  readStartedTurn(sessionId: string): ActiveCodexTurn | null {
    const entry = this.read(sessionId)
    return entry?.turnId ? entry : null
  }

  /**
   * Drop map ownership without releasing the host lease. Cancel uses this so a
   * concurrent streamTurn can register while interrupt still holds the lease.
   */
  detach(sessionId: string, entry: ActiveCodexTurn): boolean {
    if (this.entries.get(sessionId) !== entry) {
      return false
    }
    this.entries.delete(sessionId)
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
