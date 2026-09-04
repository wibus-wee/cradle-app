import { readFile } from 'node:fs/promises'

import { node } from '@elysiajs/node'
import { Elysia } from 'elysia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { assets } from './index'

const assetFixture = {
  id: 'asset-upload-route',
  workspaceId: 'workspace-upload-route',
  filename: 'hijarvis.png',
  mediaType: 'image/png',
  byteSize: 8_218,
  width: 64,
  height: 64,
  sha256: 'fe85cc327a0e56459d5224d56d835f3212d5416a40c306203f6542a722286506',
  storagePath: 'assets/workspaces/workspace-upload-route/asset-upload-route.png',
  url: '/assets/asset-upload-route/content',
  markdownUrl: 'cradle-asset://asset-upload-route',
  createdAt: 1_788_451_200,
}

const assetService = vi.hoisted(() => ({
  createAsset: vi.fn(),
  deleteAsset: vi.fn(),
  getAsset: vi.fn(),
  readAssetBytes: vi.fn(),
}))

vi.mock('./service', () => assetService)

describe('assets routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    assetService.createAsset.mockResolvedValue(assetFixture)
  })

  it('passes an Elysia-parsed multipart upload to the asset service', async () => {
    const imageBytes = await readFile(new URL('../../../../web/src/components/common/assets/hijarvis.png', import.meta.url))
    const form = new FormData()
    form.set('file', new File([imageBytes], assetFixture.filename, { type: assetFixture.mediaType }))
    form.set('workspaceId', assetFixture.workspaceId)

    const app = new Elysia({
      adapter: node(),
      normalize: 'typebox',
    }).use(assets)
    const response = await app.handle(new Request('http://localhost/assets', {
      method: 'POST',
      body: form,
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(assetFixture)
    expect(assetService.createAsset).toHaveBeenCalledOnce()

    const upload = assetService.createAsset.mock.calls[0]?.[0]
    expect(upload?.workspaceId).toBe(assetFixture.workspaceId)
    expect(upload?.file).toBeInstanceOf(File)
    expect(upload?.file.name).toBe(assetFixture.filename)
    expect(Buffer.from(await upload!.file.arrayBuffer())).toEqual(imageBytes)
  })
})
