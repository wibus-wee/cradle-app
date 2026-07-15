// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'

import { createDesktopDownloadCenterTransport, serverDownloadCenterTransport } from './transport'
import type { DownloadTask } from './types'

const { postDownloadCenterTasksByIdCancel } = vi.hoisted(() => ({
  postDownloadCenterTasksByIdCancel: vi.fn(),
}))

vi.mock('~/api-gen/sdk.gen', () => ({
  getDownloadCenterTasks: vi.fn(),
  postDownloadCenterTasksByIdCancel,
}))

vi.mock('~/lib/electron', () => ({
  getAuthenticatedEventSourceUrl: vi.fn(async (url: string) => url),
  getServerUrl: () => 'http://server.test',
  isElectron: false,
}))

function task(overrides: Partial<DownloadTask> = {}): DownloadTask {
  return {
    taskId: 'task-1',
    scope: 'server',
    owner: { namespace: 'chronicle', resourceType: 'model-resource-file', resourceId: 'resource', displayName: 'Resource' },
    fileName: 'resource.bin',
    sourceId: null,
    status: 'downloading',
    transferredBytes: 0,
    totalBytes: null,
    attempts: 1,
    maxAttempts: 3,
    error: null,
    result: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    ...overrides,
  }
}

describe('download center server transport', () => {
  it('uses the scoped server cancel route and never sends desktop task IDs to it', async () => {
    postDownloadCenterTasksByIdCancel.mockResolvedValue({ data: task({ status: 'cancelled' }) })
    await expect(serverDownloadCenterTransport.cancel(task())).resolves.toMatchObject({ status: 'cancelled' })
    await expect(serverDownloadCenterTransport.cancel(task({ scope: 'desktop' }))).resolves.toBeNull()
    expect(postDownloadCenterTasksByIdCancel).toHaveBeenCalledOnce()
    expect(postDownloadCenterTasksByIdCancel).toHaveBeenCalledWith({ path: { id: 'task-1' } })
  })

  it('waits for the reconnect snapshot before accepting stream events', async () => {
    class FakeEventSource {
      static instances: FakeEventSource[] = []
      onmessage: ((event: MessageEvent<string>) => void) | null = null
      onopen: (() => void) | null = null
      onerror: (() => void) | null = null

      constructor(_url: string) {
        FakeEventSource.instances.push(this)
      }

      close() {}
    }
    vi.stubGlobal('EventSource', FakeEventSource)
    const refresh = { finish: null as (() => void) | null }
    const reconnect = vi.fn(() => new Promise<void>((resolve) => { refresh.finish = resolve }))
    const received: DownloadTask[] = []
    const unsubscribe = serverDownloadCenterTransport.subscribe(task => received.push(task), reconnect)
    await Promise.resolve()
    await Promise.resolve()
    const source = FakeEventSource.instances[0]!

    source.onopen?.()
    source.onmessage?.({ data: JSON.stringify(task()) } as MessageEvent<string>)
    expect(received).toEqual([])
    refresh.finish?.()
    await Promise.resolve()
    source.onmessage?.({ data: JSON.stringify(task({ taskId: 'fresh-task' })) } as MessageEvent<string>)
    expect(received.map(item => item.taskId)).toEqual(['fresh-task'])
    unsubscribe()
    vi.unstubAllGlobals()
  })

  it('sends cancellation for desktop tasks only through Desktop IPC', async () => {
    const cancel = vi.fn(async () => task({ scope: 'desktop', status: 'cancelled' }))
    const transport = createDesktopDownloadCenterTransport({
      list: async () => [],
      get: async () => null,
      cancel,
      onTaskChanged: () => () => {},
    })
    await expect(transport.cancel(task({ scope: 'desktop' }))).resolves.toMatchObject({ status: 'cancelled' })
    await expect(transport.cancel(task())).resolves.toBeNull()
    expect(cancel).toHaveBeenCalledOnce()
    expect(cancel).toHaveBeenCalledWith('task-1')
  })
})
