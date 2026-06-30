import { t } from 'elysia'

export const LinkPreviewModel = {
  query: t.Object({
    url: t.String({ format: 'uri', description: 'Absolute http(s) URL to unfurl into a link card' }),
  }),
  preview: t.Object({
    url: t.String(),
    title: t.Nullable(t.String()),
    description: t.Nullable(t.String()),
    image: t.Nullable(t.String()),
    siteName: t.Nullable(t.String()),
    favicon: t.Nullable(t.String()),
  }),
} as const
