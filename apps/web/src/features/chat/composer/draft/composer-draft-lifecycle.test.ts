import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComposerDraftServerState } from './composer-draft-server'
import type { ComposerDraft } from './composer-draft-store'

const serverMocks = vi.hoisted(() => ({
  deleteServerComposerDraft: vi.fn(),
  readServerComposerDraft: vi.fn(),
  writeServerComposerDraft: vi.fn(),
}))

vi.mock('./composer-draft-server', () => serverMocks)

const SURFACE_ID = 'surface-1'
const DRAFT: ComposerDraft = {
  text: 'Draft text',
  contextParts: [],
  files: [],
  pastedTexts: [],
}

function serverState(draft: ComposerDraft | null = DRAFT) {
  return {
    surfaceId: SURFACE_ID,
    draft,
    revision: 1,
    updatedAt: 123,
    deletedAt: draft ? null : 124,
  }
}

async function importDraftModules() {
  vi.resetModules()
  const lifecycle = await import('./composer-draft-lifecycle')
  const store = await import('./composer-draft-store')
  return { lifecycle, store }
}

type Lifecycle = Awaited<ReturnType<typeof importDraftModules>>['lifecycle']
type Store = Awaited<ReturnType<typeof importDraftModules>>['store']

function activateWithPersistedDraft(
  lifecycle: Lifecycle,
  store: Store,
  draft: ComposerDraft | null = DRAFT,
) {
  if (draft) {
    store.useComposerDraftStore.getState().setDraft(SURFACE_ID, draft)
  }
  lifecycle.activateComposerDraftSurface(SURFACE_ID, draft)
}

describe('composer draft lifecycle', () => {
  beforeEach(() => {
    vi.useRealTimers()
    vi.resetAllMocks()
    serverMocks.writeServerComposerDraft.mockResolvedValue(serverState())
    serverMocks.deleteServerComposerDraft.mockResolvedValue(serverState(null))
    serverMocks.readServerComposerDraft.mockResolvedValue(serverState(null))
  })

  it('debounces non-empty writes and tombstones empty drafts', async () => {
    vi.useFakeTimers()
    const { lifecycle, store } = await importDraftModules()
    activateWithPersistedDraft(lifecycle, store, null)

    lifecycle.changeComposerDraft(SURFACE_ID, { ...DRAFT, text: 'Hello' })
    expect(serverMocks.writeServerComposerDraft).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(300)
    expect(serverMocks.writeServerComposerDraft).toHaveBeenCalledTimes(1)
    expect(serverMocks.writeServerComposerDraft).toHaveBeenCalledWith(SURFACE_ID, {
      text: 'Hello',
      contextParts: [],
      files: [],
      pastedTexts: [],
    })
    expect(store.useComposerDraftStore.getState().getDraft(SURFACE_ID)?.text).toBe('Hello')

    lifecycle.changeComposerDraft(SURFACE_ID, { text: '', contextParts: [], files: [], pastedTexts: [] })
    await lifecycle.flushComposerDraftServerQueue(SURFACE_ID)
    expect(serverMocks.deleteServerComposerDraft).toHaveBeenCalledTimes(1)
    expect(serverMocks.deleteServerComposerDraft).toHaveBeenCalledWith(SURFACE_ID)
    expect(store.useComposerDraftStore.getState().getDraft(SURFACE_ID)).toBeNull()
  })

  it('serializes server operations and dedupes repeated intents', async () => {
    const { lifecycle, store } = await importDraftModules()
    activateWithPersistedDraft(lifecycle, store)

    // Two identical tombstones in a row collapse to one delete call.
    lifecycle.clearComposerDraft(SURFACE_ID)
    lifecycle.clearComposerDraft(SURFACE_ID)
    await lifecycle.flushComposerDraftServerQueue(SURFACE_ID)
    expect(serverMocks.deleteServerComposerDraft).toHaveBeenCalledTimes(1)

    // Identical rewrite after a queued write is skipped.
    lifecycle.changeComposerDraft(SURFACE_ID, DRAFT)
    lifecycle.flushComposerDraft(SURFACE_ID)
    await lifecycle.flushComposerDraftServerQueue(SURFACE_ID)
    expect(serverMocks.writeServerComposerDraft).toHaveBeenCalledTimes(1)
    lifecycle.changeComposerDraft(SURFACE_ID, DRAFT)
    lifecycle.flushComposerDraft(SURFACE_ID)
    await lifecycle.flushComposerDraftServerQueue(SURFACE_ID)
    expect(serverMocks.writeServerComposerDraft).toHaveBeenCalledTimes(1)
  })

  it('discards in fixed order: drop pending writes, delete local, one tombstone', async () => {
    vi.useFakeTimers()
    const { lifecycle, store } = await importDraftModules()
    activateWithPersistedDraft(lifecycle, store)

    lifecycle.changeComposerDraft(SURFACE_ID, { ...DRAFT, text: 'Pending write' })
    lifecycle.discardComposerDraftSurface(SURFACE_ID)
    lifecycle.discardComposerDraftSurface(SURFACE_ID)

    await vi.advanceTimersByTimeAsync(1000)
    lifecycle.flushComposerDraft(SURFACE_ID)
    await lifecycle.flushComposerDraftServerQueue(SURFACE_ID)

    expect(serverMocks.writeServerComposerDraft).not.toHaveBeenCalled()
    expect(serverMocks.deleteServerComposerDraft).toHaveBeenCalledTimes(1)
    expect(store.useComposerDraftStore.getState().getDraft(SURFACE_ID)).toBeNull()
  })

  it('drops a queued write that was in flight behind the discard tombstone', async () => {
    const { lifecycle, store } = await importDraftModules()
    activateWithPersistedDraft(lifecycle, store)

    let releaseWrite: () => void = () => {}
    serverMocks.writeServerComposerDraft.mockImplementationOnce(
      () => new Promise<ComposerDraftServerState>((resolve) => {
        releaseWrite = () => resolve(serverState())
      }),
    )

    lifecycle.changeComposerDraft(SURFACE_ID, DRAFT)
    lifecycle.flushComposerDraft(SURFACE_ID)
    // Let the serialized write actually start before the surface is discarded.
    await vi.waitFor(() => expect(serverMocks.writeServerComposerDraft).toHaveBeenCalledTimes(1))
    lifecycle.discardComposerDraftSurface(SURFACE_ID)

    releaseWrite()
    await lifecycle.flushComposerDraftServerQueue(SURFACE_ID)

    expect(serverMocks.writeServerComposerDraft).toHaveBeenCalledTimes(1)
    expect(serverMocks.deleteServerComposerDraft).toHaveBeenCalledTimes(1)
    expect(store.useComposerDraftStore.getState().getDraft(SURFACE_ID)).toBeNull()
  })

  it('accepts writes again only after an explicit activate', async () => {
    const { lifecycle, store } = await importDraftModules()
    activateWithPersistedDraft(lifecycle, store)

    lifecycle.discardComposerDraftSurface(SURFACE_ID)
    lifecycle.changeComposerDraft(SURFACE_ID, { ...DRAFT, text: 'While closed' })
    lifecycle.flushComposerDraft(SURFACE_ID)
    await lifecycle.flushComposerDraftServerQueue(SURFACE_ID)
    expect(serverMocks.writeServerComposerDraft).not.toHaveBeenCalled()

    lifecycle.activateComposerDraftSurface(SURFACE_ID, null)
    lifecycle.changeComposerDraft(SURFACE_ID, { ...DRAFT, text: 'Reopened draft' })
    lifecycle.flushComposerDraft(SURFACE_ID)
    await lifecycle.flushComposerDraftServerQueue(SURFACE_ID)

    expect(serverMocks.writeServerComposerDraft).toHaveBeenCalledWith(SURFACE_ID, {
      text: 'Reopened draft',
      contextParts: [],
      files: [],
      pastedTexts: [],
    })
    expect(store.useComposerDraftStore.getState().getDraft(SURFACE_ID)?.text).toBe('Reopened draft')
  })

  it('flushes a pending debounced draft on unmount when not discarded', async () => {
    const { lifecycle } = await importDraftModules()
    lifecycle.activateComposerDraftSurface(SURFACE_ID, null)

    lifecycle.changeComposerDraft(SURFACE_ID, DRAFT)
    lifecycle.flushComposerDraft(SURFACE_ID)
    await lifecycle.flushComposerDraftServerQueue(SURFACE_ID)

    expect(serverMocks.writeServerComposerDraft).toHaveBeenCalledTimes(1)
  })

  it('keeps the persisted draft while a submission is pending', async () => {
    const { lifecycle, store } = await importDraftModules()
    activateWithPersistedDraft(lifecycle, store)
    await lifecycle.flushComposerDraftServerQueue(SURFACE_ID)

    const token = lifecycle.beginComposerDraftSubmit(SURFACE_ID)
    lifecycle.changeComposerDraft(SURFACE_ID, { text: '', contextParts: [], files: [], pastedTexts: [] })

    expect(serverMocks.deleteServerComposerDraft).not.toHaveBeenCalled()
    expect(store.useComposerDraftStore.getState().getDraft(SURFACE_ID)).toEqual(DRAFT)

    lifecycle.settleComposerDraftSubmit(SURFACE_ID, token, false)
    expect(serverMocks.deleteServerComposerDraft).not.toHaveBeenCalled()
    expect(store.useComposerDraftStore.getState().getDraft(SURFACE_ID)).toEqual(DRAFT)
  })

  it('commits exactly one tombstone when an accepted submission settles', async () => {
    const { lifecycle, store } = await importDraftModules()
    activateWithPersistedDraft(lifecycle, store)
    await lifecycle.flushComposerDraftServerQueue(SURFACE_ID)

    const token = lifecycle.beginComposerDraftSubmit(SURFACE_ID)
    lifecycle.changeComposerDraft(SURFACE_ID, { text: '', contextParts: [], files: [], pastedTexts: [] })
    lifecycle.settleComposerDraftSubmit(SURFACE_ID, token, true)

    // The trailing editor empty-change after settlement must not tombstone again.
    lifecycle.changeComposerDraft(SURFACE_ID, { text: '', contextParts: [], files: [], pastedTexts: [] })
    await lifecycle.flushComposerDraftServerQueue(SURFACE_ID)

    expect(serverMocks.deleteServerComposerDraft).toHaveBeenCalledTimes(1)
    expect(serverMocks.deleteServerComposerDraft).toHaveBeenCalledWith(SURFACE_ID)
    expect(store.useComposerDraftStore.getState().getDraft(SURFACE_ID)).toBeNull()
  })

  it('does not tombstone a newer draft when a stale submission settles accepted', async () => {
    const { lifecycle, store } = await importDraftModules()
    activateWithPersistedDraft(lifecycle, store)

    const token = lifecycle.beginComposerDraftSubmit(SURFACE_ID)
    lifecycle.changeComposerDraft(SURFACE_ID, { text: '', contextParts: [], files: [], pastedTexts: [] })
    lifecycle.changeComposerDraft(SURFACE_ID, { ...DRAFT, text: 'Newer draft' })
    lifecycle.settleComposerDraftSubmit(SURFACE_ID, token, true)

    lifecycle.flushComposerDraft(SURFACE_ID)
    await lifecycle.flushComposerDraftServerQueue(SURFACE_ID)

    expect(serverMocks.deleteServerComposerDraft).not.toHaveBeenCalled()
    expect(serverMocks.writeServerComposerDraft).toHaveBeenCalledWith(SURFACE_ID, {
      text: 'Newer draft',
      contextParts: [],
      files: [],
      pastedTexts: [],
    })
    expect(store.useComposerDraftStore.getState().getDraft(SURFACE_ID)?.text).toBe('Newer draft')
  })

  it('tombstones when the user drafted then cleared during a pending submission', async () => {
    const { lifecycle, store } = await importDraftModules()
    activateWithPersistedDraft(lifecycle, store)

    const token = lifecycle.beginComposerDraftSubmit(SURFACE_ID)
    lifecycle.changeComposerDraft(SURFACE_ID, { text: '', contextParts: [], files: [], pastedTexts: [] })
    lifecycle.changeComposerDraft(SURFACE_ID, { ...DRAFT, text: 'Typed then deleted' })
    lifecycle.changeComposerDraft(SURFACE_ID, { text: '', contextParts: [], files: [], pastedTexts: [] })
    lifecycle.settleComposerDraftSubmit(SURFACE_ID, token, true)
    await lifecycle.flushComposerDraftServerQueue(SURFACE_ID)

    expect(serverMocks.deleteServerComposerDraft).toHaveBeenCalledTimes(1)
    expect(serverMocks.writeServerComposerDraft).not.toHaveBeenCalled()
  })

  it('ignores superseded or unknown submit tokens', async () => {
    const { lifecycle, store } = await importDraftModules()
    activateWithPersistedDraft(lifecycle, store)

    const first = lifecycle.beginComposerDraftSubmit(SURFACE_ID)
    const second = lifecycle.beginComposerDraftSubmit(SURFACE_ID)

    lifecycle.settleComposerDraftSubmit(SURFACE_ID, first, true)
    expect(serverMocks.deleteServerComposerDraft).not.toHaveBeenCalled()

    lifecycle.settleComposerDraftSubmit(SURFACE_ID, second, true)
    await lifecycle.flushComposerDraftServerQueue(SURFACE_ID)
    expect(serverMocks.deleteServerComposerDraft).toHaveBeenCalledTimes(1)

    lifecycle.settleComposerDraftSubmit(SURFACE_ID, null, true)
    expect(store.useComposerDraftStore.getState().getDraft(SURFACE_ID)).toBeNull()
  })

  it('strips attachments from the server payload while keeping them in memory', async () => {
    const { lifecycle, store } = await importDraftModules()
    lifecycle.activateComposerDraftSurface(SURFACE_ID, null)

    const filesDraft: ComposerDraft = {
      text: 'Has attachment',
      contextParts: [],
      files: [{ type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,AAA', filename: 'a.png' }],
      pastedTexts: [],
    }
    lifecycle.changeComposerDraft(SURFACE_ID, filesDraft)
    lifecycle.flushComposerDraft(SURFACE_ID)
    await lifecycle.flushComposerDraftServerQueue(SURFACE_ID)

    expect(store.useComposerDraftStore.getState().getDraft(SURFACE_ID)?.files).toHaveLength(1)
    expect(serverMocks.writeServerComposerDraft).toHaveBeenCalledWith(SURFACE_ID, {
      text: 'Has attachment',
      contextParts: [],
      files: [],
      pastedTexts: [],
    })
  })

  it('treats an attachment-only draft as an empty persisted payload', async () => {
    const { lifecycle, store } = await importDraftModules()
    activateWithPersistedDraft(lifecycle, store)

    lifecycle.changeComposerDraft(SURFACE_ID, {
      text: '',
      contextParts: [],
      files: [{ type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,AAA' }],
      pastedTexts: [],
    })
    lifecycle.flushComposerDraft(SURFACE_ID)
    await lifecycle.flushComposerDraftServerQueue(SURFACE_ID)

    expect(serverMocks.writeServerComposerDraft).not.toHaveBeenCalled()
    expect(serverMocks.deleteServerComposerDraft).toHaveBeenCalledTimes(1)
    // The in-memory cache still mirrors the visible draft for same-session remounts.
    expect(store.useComposerDraftStore.getState().getDraft(SURFACE_ID)?.files).toHaveLength(1)
  })
})
