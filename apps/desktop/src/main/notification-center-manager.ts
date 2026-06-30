import type { BrowserWindow } from 'electron'
import { Notification } from 'electron'

import type { ChatStreamBroker } from './chat-stream-broker'

interface CompletedRun {
  runId: string
  sessionId: string
  sessionTitle: string
  messageId: string | null
  responseBody: string | null
  messagePreview: string | null
  startedAt: number
  finishedAt: number
}

interface CompletedRunsResponse {
  runs: CompletedRun[]
}

interface RuntimeStatusResponse {
  status: 'idle' | 'pending' | 'streaming' | 'cancelling'
}

interface NativeNotification {
  show: () => void
  close: () => void
  on: (eventName: 'reply' | 'click' | 'close', listener: (event: unknown, reply?: string) => void) => void
}

interface NotificationCenterManagerOptions {
  serverUrl: string
  chatStreamBroker: ChatStreamBroker
  getMainWindow?: () => BrowserWindow | null
  fetchFn?: typeof fetch
  createNotification?: (options: Electron.NotificationConstructorOptions) => NativeNotification
  pollIntervalMs?: number
  nowSeconds?: () => number
  platform?: NodeJS.Platform
}

const COMPLETED_RUNS_PATH = '/chat/runs/completed'
const DEFAULT_POLL_INTERVAL_MS = 3_000
const MAX_SEEN_RUN_IDS = 500

export class NotificationCenterManager {
  private readonly serverUrl: string
  private readonly chatStreamBroker: ChatStreamBroker
  private readonly getMainWindow: () => BrowserWindow | null
  private readonly fetchFn: typeof fetch
  private readonly createNotification: (options: Electron.NotificationConstructorOptions) => NativeNotification
  private readonly pollIntervalMs: number
  private readonly nowSeconds: () => number
  private readonly platform: NodeJS.Platform
  private seenRunIds = new Set<string>()
  private activeNotifications = new Set<NativeNotification>()
  private timer: ReturnType<typeof setInterval> | null = null
  private lastFinishedAt = 0
  private polling = false

  constructor(options: NotificationCenterManagerOptions) {
    this.serverUrl = options.serverUrl
    this.chatStreamBroker = options.chatStreamBroker
    this.getMainWindow = options.getMainWindow ?? (() => null)
    this.fetchFn = options.fetchFn ?? fetch
    this.createNotification = options.createNotification
      ?? (notificationOptions => new Notification(notificationOptions) as unknown as NativeNotification)
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    this.nowSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000))
    this.platform = options.platform ?? process.platform
  }

  start(): void {
    if (this.timer) {
      return
    }
    this.lastFinishedAt = this.nowSeconds()
    this.timer = setInterval(() => {
      void this.poll()
    }, this.pollIntervalMs)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    for (const notification of this.activeNotifications) {
      notification.close()
    }
    this.activeNotifications.clear()
  }

  async poll(): Promise<void> {
    if (this.polling) {
      return
    }
    this.polling = true
    try {
      const response = await this.fetchFn(this.buildUrl(COMPLETED_RUNS_PATH, {
        since: String(Math.max(0, this.lastFinishedAt - 1)),
        limit: '50',
      }))
      if (!response.ok) {
        return
      }
      const payload = await response.json() as CompletedRunsResponse
      const runs = [...payload.runs].sort((left, right) => left.finishedAt - right.finishedAt)
      for (const run of runs) {
        this.lastFinishedAt = Math.max(this.lastFinishedAt, run.finishedAt)
        if (this.seenRunIds.has(run.runId)) {
          continue
        }
        this.rememberRun(run.runId)
        this.showCompletionNotification(run)
      }
    }
    catch (error) {
      console.warn('[notification-center] failed to poll completed runs:', error)
    }
    finally {
      this.polling = false
    }
  }

  private showCompletionNotification(run: CompletedRun): void {
    const body = run.responseBody || run.messagePreview || '已完成'
    const notification = this.createNotification({
      title: run.sessionTitle || 'Cradle session',
      body,
      hasReply: this.platform === 'darwin',
      replyPlaceholder: '回复并继续对话',
      actions: this.platform === 'darwin'
        ? []
        : [{ type: 'button', text: 'Reply' }],
      closeButtonText: 'Close',
    })
    this.activeNotifications.add(notification)
    const releaseNotification = () => {
      this.activeNotifications.delete(notification)
    }

    notification.on('reply', (_event, reply) => {
      void this.handleReply(run.sessionId, reply)
        .then((submitted) => {
          if (submitted) {
            this.notifyChatSessionUpdated(run.sessionId)
          }
        })
        .finally(() => {
          notification.close()
          releaseNotification()
        })
    })
    notification.on('click', () => {
      this.handleNotificationClick(run.sessionId, notification)
      releaseNotification()
    })
    notification.on('close', releaseNotification)
    notification.show()
  }

  private handleNotificationClick(sessionId: string, notification: NativeNotification): void {
    const mainWindow = this.getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) {
      return
    }

    // Focus and show the main window
    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }
    mainWindow.show()
    mainWindow.focus()

    // Navigate to the session
    mainWindow.webContents.send('desktop-tray:action-requested', {
      actionId: 'open-chat',
      payload: { sessionId },
    })

    // Close the notification
    notification.close()
  }

  private notifyChatSessionUpdated(sessionId: string): void {
    const mainWindow = this.getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) {
      return
    }

    mainWindow.webContents.send('desktop-tray:action-requested', {
      actionId: 'chat-session-updated',
      payload: { sessionId },
    })
  }

  private async handleReply(sessionId: string, rawReply: string | undefined): Promise<boolean> {
    const text = rawReply?.trim()
    if (!text) {
      return false
    }

    try {
      const status = await this.readRuntimeStatus(sessionId)
      if (status.status === 'idle') {
        await this.chatStreamBroker.startResponseDetached({
          sessionId,
          body: { text },
        })
        return true
      }
      await this.enqueueReply(sessionId, text)
      return true
    }
    catch (error) {
      console.warn('[notification-center] failed to submit notification reply:', error)
      return false
    }
  }

  private async readRuntimeStatus(sessionId: string): Promise<RuntimeStatusResponse> {
    const response = await this.fetchFn(this.buildUrl(`/chat/sessions/${encodeURIComponent(sessionId)}/runtime-status`))
    if (!response.ok) {
      throw new Error(`Runtime status failed: ${response.status}`)
    }
    return await response.json() as RuntimeStatusResponse
  }

  private async enqueueReply(sessionId: string, text: string): Promise<void> {
    const response = await this.fetchFn(this.buildUrl(`/chat/sessions/${encodeURIComponent(sessionId)}/queue`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'queue', text }),
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Queue reply failed: ${response.status} ${body}`)
    }
  }

  private buildUrl(path: string, query?: Record<string, string>): URL {
    const url = new URL(path, this.serverUrl)
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, value)
    }
    return url
  }

  private rememberRun(runId: string): void {
    this.seenRunIds.add(runId)
    if (this.seenRunIds.size <= MAX_SEEN_RUN_IDS) {
      return
    }
    const oldest = this.seenRunIds.values().next().value as string | undefined
    if (oldest) {
      this.seenRunIds.delete(oldest)
    }
  }
}
