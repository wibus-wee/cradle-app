import { describe, expect, it, vi } from 'vitest'

import { NotificationCenterManager } from './notification-center-manager'

const electronMocks = vi.hoisted(() => ({
  Notification: vi.fn(),
}))

vi.mock('electron', () => electronMocks)

type Listener = (event: unknown, reply?: string) => void

class FakeNotification {
  readonly options: Electron.NotificationConstructorOptions
  readonly listeners = new Map<string, Listener[]>()
  readonly show = vi.fn()
  readonly close = vi.fn()

  constructor(options: Electron.NotificationConstructorOptions) {
    this.options = options
  }

  on(eventName: 'reply' | 'click' | 'close', listener: Listener): void {
    const listeners = this.listeners.get(eventName) ?? []
    listeners.push(listener)
    this.listeners.set(eventName, listeners)
  }

  emitReply(reply: string): void {
    for (const listener of this.listeners.get('reply') ?? []) {
      listener({}, reply)
    }
  }

  emitClick(): void {
    for (const listener of this.listeners.get('click') ?? []) {
      listener({})
    }
  }
}

function createJsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('notificationCenterManager', () => {
  it('shows a native reply notification for completed chat runs', async () => {
    const notifications: FakeNotification[] = []
    const broker = { startResponseDetached: vi.fn() }
    const fetchFn = vi.fn(async () => createJsonResponse({
      runs: [{
        runId: 'run-1',
        sessionId: 'session-1',
        sessionTitle: 'Fix the build',
        messageId: 'message-1',
        responseBody: 'The build has been fixed successfully, including the detailed final response.',
        messagePreview: 'Old preview text',
        startedAt: 100,
        finishedAt: 105,
      }],
    }))
    const manager = new NotificationCenterManager({
      serverUrl: 'http://127.0.0.1:21423',
      chatStreamBroker: broker as never,
      fetchFn: fetchFn as typeof fetch,
      createNotification: (options) => {
        const notification = new FakeNotification(options)
        notifications.push(notification)
        return notification
      },
      nowSeconds: () => 100,
      platform: 'darwin',
    })

    await manager.poll()

    expect(fetchFn).toHaveBeenCalledWith(new URL('http://127.0.0.1:21423/chat/runs/completed?since=0&limit=50'))
    expect(notifications).toHaveLength(1)
    expect(notifications[0]?.options).toMatchObject({
      title: 'Fix the build',
      body: 'The build has been fixed successfully, including the detailed final response.',
      hasReply: true,
      replyPlaceholder: '回复并继续对话',
    })
    expect(notifications[0]?.show).toHaveBeenCalledTimes(1)
  })

  it('starts a detached response when replying to an idle completed session', async () => {
    const notifications: FakeNotification[] = []
    const broker = { startResponseDetached: vi.fn(async () => ({ streamId: 'stream-1' })) }
    const mainWindow = {
      isDestroyed: vi.fn(() => false),
      webContents: { send: vi.fn() },
    }
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/runtime-status')) {
        return createJsonResponse({ status: 'idle' })
      }
      return createJsonResponse({
        runs: [{
          runId: 'run-2',
          sessionId: 'session-2',
          sessionTitle: 'Review PR',
          messageId: 'message-2',
          responseBody: 'PR reviewed and approved',
          messagePreview: 'PR reviewed and approved',
          startedAt: 100,
          finishedAt: 105,
        }],
      })
    })
    const manager = new NotificationCenterManager({
      serverUrl: 'http://127.0.0.1:21423',
      chatStreamBroker: broker as never,
      fetchFn: fetchFn as typeof fetch,
      createNotification: (options) => {
        const notification = new FakeNotification(options)
        notifications.push(notification)
        return notification
      },
      getMainWindow: () => mainWindow as never,
      platform: 'darwin',
    })

    await manager.poll()
    notifications[0]?.emitReply(' continue from here ')

    await vi.waitFor(() => {
      expect(broker.startResponseDetached).toHaveBeenCalledWith({
        sessionId: 'session-2',
        body: { text: 'continue from here' },
      })
    })
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('desktop-tray:action-requested', {
      actionId: 'chat-session-updated',
      payload: { sessionId: 'session-2' },
    })
    expect(notifications[0]?.close).toHaveBeenCalledTimes(1)
  })

  it('shows an input-required notification for pending runtime user input', async () => {
    const notifications: FakeNotification[] = []
    const broker = { startResponseDetached: vi.fn() }
    const mainWindow = {
      isDestroyed: vi.fn(() => false),
      isMinimized: vi.fn(() => false),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      webContents: { send: vi.fn() },
    }
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/desktop/user-input-requests')) {
        return createJsonResponse([
          {
            id: 'session-ask:request-ask',
            sessionId: 'session-ask',
            runId: 'run-ask',
            requestId: 'request-ask',
            title: 'Choose scope',
            workspaceId: 'workspace-1',
            workspaceName: 'Workspace',
            providerMethod: 'askUserQuestion',
            questionCount: 2,
            firstQuestion: 'Which scope should I use?',
            createdAt: 120,
          },
        ])
      }
      return createJsonResponse({ runs: [] })
    })
    const manager = new NotificationCenterManager({
      serverUrl: 'http://127.0.0.1:21423',
      chatStreamBroker: broker as never,
      fetchFn: fetchFn as typeof fetch,
      createNotification: (options) => {
        const notification = new FakeNotification(options)
        notifications.push(notification)
        return notification
      },
      getMainWindow: () => mainWindow as never,
      platform: 'darwin',
    })

    await manager.poll()

    expect(fetchFn).toHaveBeenCalledWith(new URL('http://127.0.0.1:21423/desktop/user-input-requests'))
    expect(notifications).toHaveLength(1)
    expect(notifications[0]?.options).toMatchObject({
      title: 'Choose scope',
      body: 'Needs your input: Which scope should I use? (2 questions)',
      hasReply: false,
    })
    expect(notifications[0]?.show).toHaveBeenCalledTimes(1)

    notifications[0]?.emitClick()

    expect(mainWindow.webContents.send).toHaveBeenCalledWith('desktop-tray:action-requested', {
      actionId: 'open-chat',
      payload: { sessionId: 'session-ask' },
    })
    expect(notifications[0]?.close).toHaveBeenCalledTimes(1)
  })

  it('queues a reply when the session is already busy', async () => {
    const notifications: FakeNotification[] = []
    const broker = { startResponseDetached: vi.fn() }
    const fetchFn = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/runtime-status')) {
        return createJsonResponse({ status: 'streaming' })
      }
      if (url.includes('/queue')) {
        return createJsonResponse({ ok: true })
      }
      return createJsonResponse({
        runs: [{
          runId: 'run-3',
          sessionId: 'session-3',
          sessionTitle: 'Long task',
          messageId: 'message-3',
          responseBody: 'Task completed after long processing',
          messagePreview: 'Task completed after long processing',
          startedAt: 100,
          finishedAt: 105,
        }],
      })
    })
    const manager = new NotificationCenterManager({
      serverUrl: 'http://127.0.0.1:21423',
      chatStreamBroker: broker as never,
      fetchFn: fetchFn as typeof fetch,
      createNotification: (options) => {
        const notification = new FakeNotification(options)
        notifications.push(notification)
        return notification
      },
      platform: 'darwin',
    })

    await manager.poll()
    notifications[0]?.emitReply('next step')

    await vi.waitFor(() => {
      expect(fetchFn).toHaveBeenCalledWith(
        new URL('http://127.0.0.1:21423/chat/sessions/session-3/queue'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'queue', text: 'next step' }),
        },
      )
    })
    expect(broker.startResponseDetached).not.toHaveBeenCalled()
    expect(notifications[0]?.close).toHaveBeenCalledTimes(1)
  })

  it('closes active notifications when the manager stops', async () => {
    const notifications: FakeNotification[] = []
    const broker = { startResponseDetached: vi.fn() }
    const fetchFn = vi.fn(async () => createJsonResponse({
      runs: [{
        runId: 'run-4',
        sessionId: 'session-4',
        sessionTitle: 'Stopped task',
        messageId: 'message-4',
        responseBody: 'Done',
        messagePreview: 'Done',
        startedAt: 100,
        finishedAt: 105,
      }],
    }))
    const manager = new NotificationCenterManager({
      serverUrl: 'http://127.0.0.1:21423',
      chatStreamBroker: broker as never,
      fetchFn: fetchFn as typeof fetch,
      createNotification: (options) => {
        const notification = new FakeNotification(options)
        notifications.push(notification)
        return notification
      },
      platform: 'darwin',
    })

    await manager.poll()
    manager.stop()

    expect(notifications[0]?.close).toHaveBeenCalledTimes(1)
  })
})
