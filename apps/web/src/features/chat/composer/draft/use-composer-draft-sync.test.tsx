// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComposerDraftServerState } from './composer-draft-server'
import type { ComposerDraft } from './composer-draft-store'

const serverMocks = vi.hoisted(() => ({
  deleteServerComposerDraft: vi.fn(),
  readServerComposerDraft: vi.fn(),
  writeServerComposerDraft: vi.fn(),
}))

vi.mock('./composer-draft-server', () => serverMocks)

const SURFACE_ID = 'surface-1'
const LOCAL_DRAFT: ComposerDraft = {
  text: 'Local draft',
  contextParts: [],
  files: [],
  pastedTexts: [],
}
const EMPTY_DRAFT: ComposerDraft = {
  text: '',
  contextParts: [],
  files: [],
  pastedTexts: [],
}

let useComposerDraftSync: (typeof import('./use-composer-draft-sync'))['useComposerDraftSync']
let useComposerDraftStore: (typeof import('./composer-draft-store'))['useComposerDraftStore']
let discardComposerDraftSurface: (typeof import('./composer-draft-lifecycle'))['discardComposerDraftSurface']
let flushComposerDraftServerQueue: (typeof import('./composer-draft-lifecycle'))['flushComposerDraftServerQueue']

type DraftSync = ReturnType<typeof useComposerDraftSync>

let latestSync: DraftSync | null = null

function captureLatestSync(sync: DraftSync): void {
  latestSync = sync
}

function serverDraftState(
  overrides: Partial<ComposerDraftServerState> = {},
): ComposerDraftServerState {
  return {
    surfaceId: SURFACE_ID,
    draft: null,
    revision: 0,
    updatedAt: null,
    deletedAt: null,
    ...overrides,
  }
}

function Probe({ onSync, surfaceId }: { onSync: (sync: DraftSync) => void, surfaceId: string }) {
  const sync = useComposerDraftSync(surfaceId)

  useEffect(() => {
    onSync(sync)
  }, [onSync, sync])

  return null
}

describe('useComposerDraftSync', () => {
  beforeEach(async () => {
    vi.useRealTimers()
    vi.clearAllMocks()
    localStorage.clear()
    latestSync = null
    vi.resetModules()
    ;({ useComposerDraftSync } = await import('./use-composer-draft-sync'))
    ;({ useComposerDraftStore } = await import('./composer-draft-store'))
    ;({ discardComposerDraftSurface, flushComposerDraftServerQueue } = await import(
      './composer-draft-lifecycle',
    ))
    useComposerDraftStore.setState({ drafts: {} })
    serverMocks.readServerComposerDraft.mockResolvedValue(serverDraftState())
    serverMocks.writeServerComposerDraft.mockResolvedValue(serverDraftState({ revision: 1 }))
    serverMocks.deleteServerComposerDraft.mockResolvedValue(
      serverDraftState({ revision: 1, deletedAt: 124 }),
    )
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('does not delete a restored local draft when the composer publishes its initial empty state', () => {
    useComposerDraftStore.getState().setDraft(SURFACE_ID, LOCAL_DRAFT)

    render(<Probe onSync={captureLatestSync} surfaceId={SURFACE_ID} />)

    expect(latestSync?.replaceDraft).toEqual(LOCAL_DRAFT)

    act(() => {
      latestSync?.handleDraftPartsChange('', [], [], [])
    })

    expect(useComposerDraftStore.getState().getDraft(SURFACE_ID)).toEqual(LOCAL_DRAFT)
    expect(serverMocks.deleteServerComposerDraft).not.toHaveBeenCalled()
  })

  it('uploads a local draft when the server has no draft row', async () => {
    useComposerDraftStore.getState().setDraft(SURFACE_ID, LOCAL_DRAFT)

    render(<Probe onSync={captureLatestSync} surfaceId={SURFACE_ID} />)

    await waitFor(() => {
      expect(serverMocks.writeServerComposerDraft).toHaveBeenCalledWith(SURFACE_ID, LOCAL_DRAFT)
    })
  })

  it('applies a server tombstone over a local draft', async () => {
    useComposerDraftStore.getState().setDraft(SURFACE_ID, LOCAL_DRAFT)
    serverMocks.readServerComposerDraft.mockResolvedValue(serverDraftState({
      revision: 2,
      deletedAt: 123,
    }))

    render(<Probe onSync={captureLatestSync} surfaceId={SURFACE_ID} />)

    await waitFor(() => {
      expect(useComposerDraftStore.getState().getDraft(SURFACE_ID)).toBeNull()
    })
    expect(latestSync?.replaceDraft).toEqual(EMPTY_DRAFT)
    expect(serverMocks.writeServerComposerDraft).not.toHaveBeenCalled()
  })

  it('debounces non-empty writes and tombstones empty drafts', async () => {
    vi.useFakeTimers()
    render(<Probe onSync={captureLatestSync} surfaceId={SURFACE_ID} />)

    act(() => {
      latestSync?.handleDraftPartsChange('Hello', [], [], [])
    })

    expect(useComposerDraftStore.getState().getDraft(SURFACE_ID)).toBeNull()
    expect(serverMocks.writeServerComposerDraft).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })

    const draft = { text: 'Hello', contextParts: [], files: [], pastedTexts: [] }
    expect(useComposerDraftStore.getState().getDraft(SURFACE_ID)).toEqual(draft)
    expect(serverMocks.writeServerComposerDraft).toHaveBeenCalledWith(SURFACE_ID, draft)

    act(() => {
      latestSync?.handleDraftPartsChange('', [], [], [])
    })
    await act(async () => {
      await flushComposerDraftServerQueue(SURFACE_ID)
    })

    expect(useComposerDraftStore.getState().getDraft(SURFACE_ID)).toBeNull()
    expect(serverMocks.deleteServerComposerDraft).toHaveBeenCalledWith(SURFACE_ID)
  })

  it('does not resurrect a discarded surface draft when unmounting with a pending debounce', async () => {
    vi.useFakeTimers()
    const view = render(<Probe onSync={captureLatestSync} surfaceId={SURFACE_ID} />)

    act(() => {
      latestSync?.handleDraftPartsChange('Unsent draft', [], [], [])
    })

    // Navigation closes the surface while the debounce is still pending.
    act(() => {
      discardComposerDraftSurface(SURFACE_ID)
    })

    view.unmount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    await flushComposerDraftServerQueue(SURFACE_ID)

    expect(useComposerDraftStore.getState().getDraft(SURFACE_ID)).toBeNull()
    expect(serverMocks.writeServerComposerDraft).not.toHaveBeenCalled()
    expect(serverMocks.deleteServerComposerDraft).toHaveBeenCalledTimes(1)
  })

  it('defers the tombstone until a pending submission is accepted', async () => {
    vi.useFakeTimers()
    render(<Probe onSync={captureLatestSync} surfaceId={SURFACE_ID} />)

    act(() => {
      latestSync?.handleDraftPartsChange('Send me', [], [], [])
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(serverMocks.writeServerComposerDraft).toHaveBeenCalledTimes(1)

    const token = latestSync?.beginDraftSubmit() ?? null
    act(() => {
      latestSync?.handleDraftPartsChange('', [], [], [])
    })
    expect(serverMocks.deleteServerComposerDraft).not.toHaveBeenCalled()
    expect(useComposerDraftStore.getState().getDraft(SURFACE_ID)?.text).toBe('Send me')

    act(() => {
      latestSync?.settleDraftSubmit(token, true)
    })
    await flushComposerDraftServerQueue(SURFACE_ID)
    expect(serverMocks.deleteServerComposerDraft).toHaveBeenCalledTimes(1)
  })

  it('keeps the persisted draft when a pending submission is rejected', async () => {
    vi.useFakeTimers()
    render(<Probe onSync={captureLatestSync} surfaceId={SURFACE_ID} />)

    act(() => {
      latestSync?.handleDraftPartsChange('Send me', [], [], [])
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })

    const token = latestSync?.beginDraftSubmit() ?? null
    act(() => {
      latestSync?.handleDraftPartsChange('', [], [], [])
    })
    act(() => {
      latestSync?.settleDraftSubmit(token, false)
    })
    await flushComposerDraftServerQueue(SURFACE_ID)

    expect(serverMocks.deleteServerComposerDraft).not.toHaveBeenCalled()
    expect(useComposerDraftStore.getState().getDraft(SURFACE_ID)?.text).toBe('Send me')
  })
})
