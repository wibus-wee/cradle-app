// @vitest-environment node
// Prefer: pnpm exec vitest run --config vitest.transport.config.ts <this-file>

import { describe, expect, it, vi } from 'vitest'

import { createDesktopDownloadCenterTransport, serverDownloadCenterTransport } from './transport'
import type { DownloadTask } from './types'

const { postDownloadCenterTasksByIdCancel, openServerEventSource } = vi.hoisted(() => ({
  postDownloadCenterTasksByIdCancel: vi.fn(),
  openServerEventSource: vi.fn(),
}))

vi.mock('~/api-gen/sdk.gen', () => ({
  getDownloadCenterTasks: vi.fn(),
  postDownloadCenterTasksByIdCancel,
}))

vi.mock('~/lib/electron', () => ({
  getServerUrl: () => 'http://server.test',
  isElectron: false,
}))

vi.mock('~/lib/server-transport', () => ({
  openServerEventSource,
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

class FakeServerEventSource {
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null

  close() {}
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
    const source = new FakeServerEventSource()
    openServerEventSource.mockReturnValue(source)
    const refresh = { finish: null as (() => void) | null }
    const reconnect = vi.fn(() => new Promise<void>((resolve) => { refresh.finish = resolve }))
    const received: DownloadTask[] = []
    const unsubscribe = serverDownloadCenterTransport.subscribe(task => received.push(task), reconnect)
    expect(openServerEventSource).toHaveBeenCalledWith('http://server.test/download-center/events')

    source.onopen?.()
    source.onmessage?.({ data: JSON.stringify(task()) } as MessageEvent<string>)
    expect(received).toEqual([])
    refresh.finish?.()
    await Promise.resolve()
    source.onmessage?.({ data: JSON.stringify(task({ taskId: 'fresh-task' })) } as MessageEvent<string>)
    expect(received.map(item => item.taskId)).toEqual(['fresh-task'])
    unsubscribe()
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
