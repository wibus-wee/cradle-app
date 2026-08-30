import { describe, expect, it, vi } from 'vitest'

import {
  DESKTOP_SERVER_FETCH_DOCUMENT_CHANNEL,
  DESKTOP_SERVER_FETCH_OPEN_CHANNEL,
} from '../shared/server-fetch-transport'
import { createDesktopServerFetchBridge } from './server-fetch'

describe('desktop Server fetch preload bridge', () => {
  it('registers one preload-owned document id and injects it into every open', async () => {
    const send = vi.fn()
    const invoke = vi.fn(async () => ({ requestId: 'request-1', cancelled: true as const }))
    const bridge = createDesktopServerFetchBridge({
      invoke,
      send,
      on: vi.fn(),
      removeListener: vi.fn(),
    })
    const documentRegistration = send.mock.calls[0]
    expect(documentRegistration?.[0]).toBe(DESKTOP_SERVER_FETCH_DOCUMENT_CHANNEL)
    expect(documentRegistration?.[1]).toEqual(expect.any(String))

    await bridge.open({
      requestId: 'request-1',
      generation: 1,
      method: 'GET',
      path: '/health',
      headers: [],
      body: null,
    })

    expect(invoke).toHaveBeenCalledWith(DESKTOP_SERVER_FETCH_OPEN_CHANNEL, {
      requestId: 'request-1',
      documentId: documentRegistration?.[1],
      generation: 1,
      method: 'GET',
      path: '/health',
      headers: [],
      body: null,
    })
  })

  it('uses a different document id for a new preload instance', () => {
    const firstSend = vi.fn()
    const secondSend = vi.fn()
    const ipcRenderer = (send: typeof firstSend) => ({
      invoke: vi.fn(),
      send,
      on: vi.fn(),
      removeListener: vi.fn(),
    })

    createDesktopServerFetchBridge(ipcRenderer(firstSend))
    createDesktopServerFetchBridge(ipcRenderer(secondSend))

    expect(firstSend.mock.calls[0]?.[1]).not.toBe(secondSend.mock.calls[0]?.[1])
  })
})
