import { Elysia } from 'elysia'

import { AssetsModel } from './model'
import * as Assets from './service'

export const assets = new Elysia({
  prefix: '/assets',
  detail: { tags: ['assets'] },
})
  .post('/', ({ body }) => {
    return Assets.createAsset({
      file: body.file,
      workspaceId: body.workspaceId,
    })
  }, {
    detail: {
      summary: 'Upload asset',
      description: 'Upload a Cradle-owned image asset with multipart/form-data fields: file and optional workspaceId. This route is HTTP-only because generated CLI commands do not model file uploads well.',
    },
    body: AssetsModel.uploadBody,
    response: { 200: AssetsModel.asset },
  })
  .get('/:id', ({ params }) => Assets.getAsset(params.id), {
    detail: {
      summary: 'Get asset metadata',
    },
    params: AssetsModel.idParams,
    response: { 200: AssetsModel.asset },
  })
  .get('/:id/content', async ({ params }) => {
    const asset = await Assets.readAssetBytes(params.id)
    return new Response(new Uint8Array(asset.bytes), {
      headers: {
        'content-type': asset.mediaType,
        'content-length': String(asset.byteSize),
        'x-content-type-options': 'nosniff',
        'cache-control': 'private, max-age=31536000, immutable',
      },
    })
  }, {
    detail: {
      summary: 'Read asset content',
      description: 'Return the stored asset bytes. The first implementation is image-only and does not implement Range requests.',
    },
    params: AssetsModel.idParams,
  })
  .delete('/:id', async ({ params }) => {
    await Assets.deleteAsset(params.id)
    return { ok: true as const }
  }, {
    detail: {
      summary: 'Delete asset',
    },
    params: AssetsModel.idParams,
    response: { 200: AssetsModel.deleteResponse },
  })
