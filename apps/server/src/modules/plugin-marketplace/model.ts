import { t } from 'elysia'

const marketplaceCategory = t.Union([
  t.Literal('automation'),
  t.Literal('mcp'),
  t.Literal('integration'),
  t.Literal('skill'),
  t.Literal('dev'),
])

const marketplaceSource = t.Object({
  kind: t.Union([t.Literal('git'), t.Literal('npm')]),
  location: t.String({ minLength: 1 }),
  ref: t.Union([t.String(), t.Null()]),
  subPath: t.Union([t.String(), t.Null()]),
}, { additionalProperties: false })

const marketplaceAuthor = t.Object({
  name: t.String({ minLength: 1 }),
  url: t.Union([t.String(), t.Null()]),
}, { additionalProperties: false })

const marketplaceEntry = t.Object({
  id: t.String({ minLength: 1 }),
  displayName: t.String({ minLength: 1 }),
  description: t.String(),
  icon: t.Union([t.String({ minLength: 1 }), t.Null()]),
  category: marketplaceCategory,
  tags: t.Array(t.String()),
  author: marketplaceAuthor,
  homepage: t.Union([t.String(), t.Null()]),
  bundled: t.Boolean(),
  source: t.Union([marketplaceSource, t.Null()]),
  featured: t.Boolean(),
  version: t.Union([t.String(), t.Null()]),
}, { additionalProperties: false })

const marketplaceResponse = t.Object({
  plugins: t.Array(marketplaceEntry),
  stale: t.Boolean(),
  fetchedAt: t.Union([t.Number(), t.Null()]),
}, { additionalProperties: false })

export const MarketplaceModel = {
  marketplaceEntry,
  marketplaceResponse,
} as const
