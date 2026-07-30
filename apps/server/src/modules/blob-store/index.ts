import { Elysia } from 'elysia'

import { BlobStoreModel } from './model'
import * as BlobStore from './service'

export const blobStore = new Elysia({
  prefix: '/blobs',
  detail: { tags: ['blob-store'] },
})
  .get('/:id', ({ params }) => BlobStore.getBlob(params.id), {
    detail: {
      summary: 'Get blob metadata',
    },
    params: BlobStoreModel.idParams,
    response: { 200: BlobStoreModel.blob },
  })
