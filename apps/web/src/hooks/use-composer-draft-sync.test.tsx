// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComposerDraftServerState } from '~/features/chat/commands/composer-draft-command'
import type { ComposerDraft } from '~/store/composer-draft'
import { useComposerDraftStore } from '~/store/composer-draft'

import { useComposerDraftSync } from './use-composer-draft-sync'

const commandMocks = vi.hoisted(() => ({
  activateComposerDraftSurface: vi.fn(),
  queueServerComposerDraftDelete: vi.fn(),
  queueServerComposerDraftWrite: vi.fn(),
  readServerComposerDraft: vi.fn(),
}))

vi.mock('~/features/chat/commands/composer-draft-command', () => commandMocks)

type DraftSync = ReturnType<typeof useComposerDraftSync>

const SURFACE_ID = 'surface-1'
const LOCAL_DRAFT: ComposerDraft = {
  text: 'Local draft',
  contextParts: [],
  files: [],
  pastedTexts: [],
}

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
  beforeEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    localStorage.clear()
    latestSync = null
    useComposerDraftStore.setState({ drafts: {} })
    commandMocks.readServerComposerDraft.mockResolvedValue(serverDraftState())
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
    expect(commandMocks.queueServerComposerDraftDelete).not.toHaveBeenCalled()
  })

  it('uploads a local draft when the server has no draft row', async () => {
    useComposerDraftStore.getState().setDraft(SURFACE_ID, LOCAL_DRAFT)

    render(<Probe onSync={captureLatestSync} surfaceId={SURFACE_ID} />)

    await waitFor(() => {
      expect(commandMocks.queueServerComposerDraftWrite).toHaveBeenCalledWith(SURFACE_ID, LOCAL_DRAFT)
    })
  })

  it('applies a server tombstone over a local draft', async () => {
    useComposerDraftStore.getState().setDraft(SURFACE_ID, LOCAL_DRAFT)
    commandMocks.readServerComposerDraft.mockResolvedValue(serverDraftState({
      revision: 2,
      deletedAt: 123,
    }))

    render(<Probe onSync={captureLatestSync} surfaceId={SURFACE_ID} />)

    await waitFor(() => {
      expect(useComposerDraftStore.getState().getDraft(SURFACE_ID)).toBeNull()
    })
    expect(latestSync?.replaceDraft).toEqual({
      text: '',
      contextParts: [],
      files: [],
      pastedTexts: [],
    })
    expect(commandMocks.queueServerComposerDraftWrite).not.toHaveBeenCalled()
  })

  it('debounces non-empty writes and tombstones empty drafts', () => {
    vi.useFakeTimers()
    render(<Probe onSync={captureLatestSync} surfaceId={SURFACE_ID} />)

    act(() => {
      latestSync?.handleDraftPartsChange('Hello', [], [], [])
    })

    expect(useComposerDraftStore.getState().getDraft(SURFACE_ID)).toBeNull()
    expect(commandMocks.queueServerComposerDraftWrite).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(300)
    })

    const draft = { text: 'Hello', contextParts: [], files: [], pastedTexts: [] }
    expect(useComposerDraftStore.getState().getDraft(SURFACE_ID)).toEqual(draft)
    expect(commandMocks.queueServerComposerDraftWrite).toHaveBeenCalledWith(SURFACE_ID, draft)

    act(() => {
      latestSync?.handleDraftPartsChange('', [], [], [])
    })

    expect(useComposerDraftStore.getState().getDraft(SURFACE_ID)).toBeNull()
    expect(commandMocks.queueServerComposerDraftDelete).toHaveBeenCalledWith(SURFACE_ID)
  })
})
