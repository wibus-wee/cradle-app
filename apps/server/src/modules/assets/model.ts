import { t } from 'elysia'

export const AssetsModel = {
  idParams: t.Object({
    id: t.String({ minLength: 1 }),
  }),

  asset: t.Object({
    id: t.String(),
    workspaceId: t.Nullable(t.String()),
    filename: t.String(),
    mediaType: t.String(),
    byteSize: t.Number(),
    width: t.Nullable(t.Number()),
    height: t.Nullable(t.Number()),
    sha256: t.String(),
    storagePath: t.String(),
    url: t.String(),
    markdownUrl: t.String(),
    createdAt: t.Number(),
  }),

  deleteResponse: t.Object({
    ok: t.Literal(true),
  }),
}
