import { t } from 'elysia'

export const BlobStoreModel = {
  idParams: t.Object({
    id: t.String({ minLength: 1 }),
  }),

  blob: t.Object({
    id: t.String(),
    sha256: t.String(),
    mediaType: t.String(),
    byteSize: t.Number(),
    storagePath: t.String(),
    createdAt: t.Number(),
  }),
}
