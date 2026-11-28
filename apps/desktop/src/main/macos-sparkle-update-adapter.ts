import type { SparkleBridge, SparkleBridgeEvent } from 'electron-sparkle-updater'
import { loadSparkleBridgeForApp } from 'electron-sparkle-updater'

import {
  readSparkleAppcastUrl,
  readSparklePublicEdKey,
  readUpdateFeedUrl,
} from './update-feed'

export type { SparkleBridgeEvent }

export type MacOSSparkleUpdateAdapterOptions = {
  updateFeedUrl?: string | null
  appcastUrl?: string | null
  publicEdKey?: string | null
  loadBridge?: typeof loadSparkleBridgeForApp
  log?: (message: string) => void
}

export type MacOSSparkleInitResult = {
  ready: boolean
  errorMessage: string | null
}

/**
 * macOS update transport owned by Sparkle via electron-sparkle-updater.
 *
 * Since electron-sparkle-updater 0.3, Sparkle's user driver is silent: there is
 * no native update UI, and every update found is downloaded automatically.
 * The bridge reports the lifecycle through `setEventHandler`; Cradle forwards
 * those events to the single `onEvent` consumer (DesktopUpdateManager), which
 * owns their mapping onto the renderer-visible update status. Installation is
 * explicit: `installUpdateNow()` installs and relaunches, `installUpdateOnQuit()`
 * stages the downloaded update for the app's own termination.
 */
export class MacOSSparkleUpdateAdapter {
  private readonly appcastUrl: string | null
  private readonly publicEdKey: string | null
  private readonly loadBridge: typeof loadSparkleBridgeForApp
  private readonly log: (message: string) => void
  private eventHandler: ((event: SparkleBridgeEvent) => void) | null = null
  private bridge: SparkleBridge | null = null
  private initialized = false
  private initError: string | null = null

  constructor(options: MacOSSparkleUpdateAdapterOptions) {
    this.appcastUrl = options.appcastUrl ?? readSparkleAppcastUrl(options.updateFeedUrl ?? readUpdateFeedUrl())
    this.publicEdKey = options.publicEdKey ?? readSparklePublicEdKey()
    this.loadBridge = options.loadBridge ?? loadSparkleBridgeForApp
    this.log = options.log ?? ((message: string) => console.log(`[sparkle] ${message}`))
  }

  get isReady(): boolean {
    return this.initialized && this.bridge !== null
  }

  get lastInitError(): string | null {
    return this.initError
  }

  async initialize(): Promise<MacOSSparkleInitResult> {
    if (this.initialized) {
      return {
        ready: this.bridge !== null,
        errorMessage: this.initError,
      }
    }

    this.initialized = true

    if (!this.appcastUrl) {
      this.initError = 'CRADLE_DESKTOP_SPARKLE_APPCAST_URL / CRADLE_DESKTOP_UPDATE_URL is not configured'
      return { ready: false, errorMessage: this.initError }
    }

    if (new URL(this.appcastUrl).protocol !== 'https:' && process.env.CRADLE_DESKTOP_ALLOW_DEV_UPDATES !== 'true') {
      this.initError = 'Desktop Sparkle appcast URL must use HTTPS'
      return { ready: false, errorMessage: this.initError }
    }

    if (!this.publicEdKey) {
      this.initError = 'SPARKLE_ED_PUBLIC_KEY is not configured'
      return { ready: false, errorMessage: this.initError }
    }

    const bridge = await this.loadBridge(this.log)
    if (!bridge) {
      this.initError = 'Sparkle bridge is unavailable (rebuild electron-sparkle-updater for this Electron ABI)'
      return { ready: false, errorMessage: this.initError }
    }

    const ok = bridge.init({
      appcastUrl: this.appcastUrl,
      publicEdKey: this.publicEdKey,
    })
    if (!ok) {
      this.initError = 'Sparkle failed to initialize with the configured appcast and public key'
      return { ready: false, errorMessage: this.initError }
    }

    this.bridge = bridge
    this.initError = null
    if (this.eventHandler) {
      bridge.setEventHandler(this.eventHandler)
    }
    return { ready: true, errorMessage: null }
  }

  /**
   * Routes Sparkle lifecycle events to the consumer. Pass null before process
   * teardown so the N-API thread-safe function is not invoked after the JS
   * handler is gone.
   */
  setEventHandler(handler: ((event: SparkleBridgeEvent) => void) | null): void {
    this.eventHandler = handler
    this.bridge?.setEventHandler(handler)
  }

  setAutomaticChecks(enabled: boolean): void {
    this.bridge?.setAutomaticChecks(enabled)
  }

  /**
   * Starts a silent update check. Results arrive as events; nothing is shown
   * natively. When a check is already in progress Sparkle queues it and runs it
   * once the current cycle finishes.
   */
  checkForUpdates(): void {
    this.assertReady()
    this.bridge!.checkForUpdates()
  }

  /**
   * Installs an already-downloaded update immediately; Sparkle terminates and
   * relaunches the app. If no update is staged yet, the next ready update
   * installs without a second prompt.
   */
  installUpdateNow(): void {
    this.assertReady()
    this.bridge!.installUpdateNow()
  }

  /**
   * Stages the downloaded update so Sparkle installs it when the app terminates
   * on its own. If nothing is staged yet, the next downloaded update is staged
   * the same way.
   */
  installUpdateOnQuit(): void {
    this.assertReady()
    this.bridge!.installUpdateOnQuit()
  }

  /**
   * Drops a downloaded or staged update so the next check re-reads the appcast
   * instead of resuming the old download.
   */
  discardDownloadedUpdate(): void {
    this.assertReady()
    this.bridge!.discardDownloadedUpdate()
  }

  private assertReady(): void {
    if (!this.bridge) {
      throw new Error(this.initError ?? 'Sparkle bridge is not ready')
    }
  }
}
