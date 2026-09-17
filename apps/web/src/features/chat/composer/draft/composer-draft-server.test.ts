import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComposerDraft } from './composer-draft-store'

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

async function readServerModule() {
  vi.resetModules()
  return await import('./composer-draft-server')
}

describe('composer draft server adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sdkMocks.getChatComposerDraftsBySurfaceId.mockResolvedValue(serverResponse())
    sdkMocks.putChatComposerDraftsBySurfaceId.mockResolvedValue(serverResponse())
    sdkMocks.deleteChatComposerDraftsBySurfaceId.mockResolvedValue(serverResponse(null))
  })

  it('projects generated draft responses into the web draft type', async () => {
    const server = await readServerModule()

    const response = await server.writeServerComposerDraft(SURFACE_ID, DRAFT)

    expect(response.draft).toEqual(DRAFT)
    expect(sdkMocks.putChatComposerDraftsBySurfaceId).toHaveBeenCalledWith({
      path: { surfaceId: SURFACE_ID },
      body: { draft: DRAFT },
      throwOnError: true,
    })
  })

  it('never sends attachments in the draft write payload', async () => {
    const server = await readServerModule()
    const draftWithAttachment: ComposerDraft = {
      ...DRAFT,
      files: [
        {
          type: 'file',
          mediaType: 'image/png',
          url: 'data:image/png;base64,AAA',
          filename: 'a.png',
        },
      ],
    }

    await server.writeServerComposerDraft(SURFACE_ID, draftWithAttachment)

    expect(sdkMocks.putChatComposerDraftsBySurfaceId).toHaveBeenCalledWith({
      path: { surfaceId: SURFACE_ID },
      body: {
        draft: {
          text: 'Queued draft',
          contextParts: [],
          files: [],
          pastedTexts: [],
        },
      },
      throwOnError: true,
    })
  })
})
