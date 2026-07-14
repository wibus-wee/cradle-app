import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComposerDraft } from '~/store/composer-draft'

const sdkMocks = vi.hoisted(() => ({
  deleteChatComposerDraftsBySurfaceId: vi.fn(),
  getChatComposerDraftsBySurfaceId: vi.fn(),
  putChatComposerDraftsBySurfaceId: vi.fn(),
}))

vi.mock('~/api-gen/sdk.gen', () => sdkMocks)

const SURFACE_ID = 'surface-1'
const DRAFT: ComposerDraft = {
  text: 'Queued draft',
  contextParts: [],
  files: [],
  pastedTexts: [],
}

function serverResponse(draft: ComposerDraft | null = DRAFT) {
  return {
    data: {
      surfaceId: SURFACE_ID,
      draft,
      revision: 1,
      updatedAt: 123,
      deletedAt: draft ? null : 124,
    },
  }
}

async function readCommandModule() {
  vi.resetModules()
  return await import('./composer-draft-command')
}

describe('composer draft command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sdkMocks.getChatComposerDraftsBySurfaceId.mockResolvedValue(serverResponse())
    sdkMocks.putChatComposerDraftsBySurfaceId.mockResolvedValue(serverResponse())
    sdkMocks.deleteChatComposerDraftsBySurfaceId.mockResolvedValue(serverResponse(null))
  })

  it('projects generated draft responses into the web draft type', async () => {
    const command = await readCommandModule()

    const response = await command.writeServerComposerDraft(SURFACE_ID, DRAFT)

    expect(response.draft).toEqual(DRAFT)
    expect(sdkMocks.putChatComposerDraftsBySurfaceId).toHaveBeenCalledWith({
      path: { surfaceId: SURFACE_ID },
      body: { draft: DRAFT },
      throwOnError: true,
    })
  })

  it('skips queued writes after a surface is discarded', async () => {
    const command = await readCommandModule()

    command.markComposerDraftSurfaceDiscarded(SURFACE_ID)
    command.queueServerComposerDraftWrite(SURFACE_ID, DRAFT)
    await command.flushComposerDraftServerQueue(SURFACE_ID)

    expect(sdkMocks.putChatComposerDraftsBySurfaceId).not.toHaveBeenCalled()
  })

  it('still sends tombstones after a surface is discarded', async () => {
    const command = await readCommandModule()

    command.markComposerDraftSurfaceDiscarded(SURFACE_ID)
    command.queueServerComposerDraftDelete(SURFACE_ID)
    await command.flushComposerDraftServerQueue(SURFACE_ID)

    expect(sdkMocks.deleteChatComposerDraftsBySurfaceId).toHaveBeenCalledWith({
      path: { surfaceId: SURFACE_ID },
      throwOnError: true,
    })
  })
})
