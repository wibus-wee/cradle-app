// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useProtectedBlobUrl } from './use-protected-blob-url'

const mocks = vi.hoisted(() => ({
  cradleFetch: vi.fn(),
}))

vi.mock('~/lib/server-credential', () => ({ cradleFetch: mocks.cradleFetch }))
vi.mock('./blob-url', () => ({
  readBlobIdFromUrl: (url: string) => (url.startsWith('cradle-blob://') ? 'blob-1' : null),
  toBlobContentUrl: (blobId: string, sessionId: string) =>
    `/chat/sessions/${sessionId}/blobs/${blobId}/content`,
}))

describe('useProtectedBlobUrl', () => {
  let createObjectUrl: ReturnType<typeof vi.fn>
  let revokeObjectUrl: ReturnType<typeof vi.fn>

  beforeEach(() => {
    createObjectUrl = vi.fn().mockReturnValue('blob:shared-image')
    revokeObjectUrl = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectUrl })
    mocks.cradleFetch.mockResolvedValue(
      new Response(new Blob(['image bytes']), {
        headers: { 'content-type': 'image/png' },
      }),
    )
  })

  afterEach(async () => {
    cleanup()
    await new Promise(resolve => setTimeout(resolve, 0))
    vi.clearAllMocks()
  })

  it('shares one authenticated download and object URL between consumers', async () => {
    const first = renderHook(() => useProtectedBlobUrl('cradle-blob://blob-1', 'session-1'))
    const second = renderHook(() => useProtectedBlobUrl('cradle-blob://blob-1', 'session-1'))

    await waitFor(() => {
      expect(first.result.current).toBe('blob:shared-image')
      expect(second.result.current).toBe('blob:shared-image')
    })

    expect(mocks.cradleFetch).toHaveBeenCalledOnce()
    expect(mocks.cradleFetch).toHaveBeenCalledWith('/chat/sessions/session-1/blobs/blob-1/content')
    expect(createObjectUrl).toHaveBeenCalledOnce()

    first.unmount()
    expect(revokeObjectUrl).not.toHaveBeenCalled()

    second.unmount()
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(revokeObjectUrl).toHaveBeenCalledOnce()
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:shared-image')
  })

  it('passes through non-blob URLs without fetching or creating object URLs', () => {
    const result = renderHook(() =>
      useProtectedBlobUrl('https://example.com/image.png', 'session-1'))

    expect(result.result.current).toBe('https://example.com/image.png')
    expect(mocks.cradleFetch).not.toHaveBeenCalled()
    expect(createObjectUrl).not.toHaveBeenCalled()
  })
})
