import type { SparkleBridge } from 'electron-sparkle-updater'
import { loadSparkleBridgeForApp } from 'electron-sparkle-updater'

import {
  readSparkleAppcastUrl,
  readSparklePublicEdKey,
  readUpdateFeedUrl,
} from './update-feed'

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
 * Sparkle owns discovery, download, install, relaunch, and update UI once the
 * native bridge is initialized. Cradle only configures and invokes the bridge.
 */
export class MacOSSparkleUpdateAdapter {
  private readonly appcastUrl: string | null
  private readonly publicEdKey: string | null
  private readonly loadBridge: typeof loadSparkleBridgeForApp
  private readonly log: (message: string) => void
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
    return { ready: true, errorMessage: null }
  }

  setAutomaticChecks(enabled: boolean): void {
    this.bridge?.setAutomaticChecks(enabled)
  }

  /**
   * Opens Sparkle's native update UI. Sparkle owns discovery + download from here.
   */
  checkForUpdatesWithUI(): void {
    if (!this.bridge) {
      throw new Error(this.initError ?? 'Sparkle bridge is not ready')
    }
    this.bridge.checkForUpdates()
  }
}
