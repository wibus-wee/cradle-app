import { createChildLogger } from '../../logging/logger'
import { maintainRunSnapshots } from './run-snapshot'

const logger = createChildLogger({ module: 'chat-runtime.run-snapshot-maintenance' })
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000

export class RunSnapshotMaintenanceScheduler {
  private timer: ReturnType<typeof setInterval> | null = null

  start(): void {
    if (this.timer) {
      return
    }
    this.runOnce()
    this.timer = setInterval(() => this.runOnce(), DEFAULT_INTERVAL_MS)
    this.timer.unref()
  }

  stop(): void {
    if (!this.timer) {
      return
    }
    clearInterval(this.timer)
    this.timer = null
  }

  private runOnce(): void {
    try {
      const result = maintainRunSnapshots()
      if (result.compactedEventPayloads > 0 || result.prunedSnapshots > 0) {
        logger.info('completed run snapshot maintenance batch', { ...result })
      }
    }
    catch (error) {
      logger.warn('run snapshot maintenance batch failed', { error })
    }
  }
}
