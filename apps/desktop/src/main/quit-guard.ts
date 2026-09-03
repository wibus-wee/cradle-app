import { app, BrowserWindow } from 'electron'

export interface DesktopPreferences {
  requireDoubleCommandQToQuit: boolean
}

const QUIT_ARMED_WINDOW_MS = 2_000
const DESKTOP_QUIT_GUARD_ARMED_CHANNEL = 'desktop:quit-guard-armed'

export class QuitGuard {
  private preferences: DesktopPreferences = {
    requireDoubleCommandQToQuit: true,
  }

  private armedUntilMs = 0

  updatePreferences(preferences: Partial<DesktopPreferences>): DesktopPreferences {
    this.preferences = {
      ...this.preferences,
      ...preferences,
    }
    if (!this.preferences.requireDoubleCommandQToQuit) {
      this.armedUntilMs = 0
    }
    return this.preferences
  }

  handleCommandQ(): void {
    if (!this.preferences.requireDoubleCommandQToQuit) {
      app.quit()
      return
    }

    const now = Date.now()
    if (now <= this.armedUntilMs) {
      this.armedUntilMs = 0
      app.quit()
      return
    }

    this.armedUntilMs = now + QUIT_ARMED_WINDOW_MS
    this.notifyQuitArmed()
  }

  private notifyQuitArmed(): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(DESKTOP_QUIT_GUARD_ARMED_CHANNEL, {
          expiresAt: this.armedUntilMs,
        })
      }
    }
  }
}

export { DESKTOP_QUIT_GUARD_ARMED_CHANNEL }
