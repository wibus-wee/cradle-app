import { t } from 'elysia'

const matchRange = t.Object({
  start: t.Number(),
  end: t.Number(),
})

const threadSearchSnippet = t.Object({
  text: t.String(),
  ranges: t.Array(matchRange),
  messageRole: t.Union([t.Literal('user'), t.Literal('assistant')]),
  messageId: t.String(),
  createdAt: t.Number(),
})

const threadSearchHit = t.Object({
  sessionId: t.String(),
  workspaceId: t.Nullable(t.String()),
  workspaceName: t.Nullable(t.String()),
  sessionTitle: t.Nullable(t.String()),
  origin: t.String(),
  titleRanges: t.Array(matchRange),
  snippets: t.Array(threadSearchSnippet),
  matchCount: t.Number(),
  score: t.Number(),
  updatedAt: t.Number(),
})

const chronicleSearchSnippet = t.Object({
  text: t.String(),
  ranges: t.Array(matchRange),
})

const chronicleSearchHit = t.Object({
  type: t.Union([t.Literal('memory'), t.Literal('knowledge')]),
  id: t.String(),
  workspaceId: t.Nullable(t.String()),
  workspaceName: t.Nullable(t.String()),
  title: t.String(),
  titleRanges: t.Array(matchRange),
  snippet: chronicleSearchSnippet,
  matchCount: t.Number(),
  score: t.Number(),
  updatedAt: t.Number(),
  memoryType: t.Optional(t.Union([t.Literal('10min'), t.Literal('6h')])),
  memorySource: t.Optional(t.Union([t.Literal('llm'), t.Literal('local'), t.Literal('imported')])),
  cardType: t.Optional(t.Union([
    t.Literal('fact'),
    t.Literal('insight'),
    t.Literal('decision'),
    t.Literal('task'),
    t.Literal('pattern'),
  ])),
  dimension: t.Optional(t.Union([
    t.Literal('technical'),
    t.Literal('business'),
    t.Literal('personal'),
    t.Literal('project'),
    t.Literal('general'),
  ])),
  status: t.Optional(t.Union([
    t.Literal('active'),
    t.Literal('merged'),
    t.Literal('archived'),
    t.Literal('deleted'),
  ])),
})

export const SearchModel = {
  threadSearchResponse: t.Array(threadSearchHit),
  chronicleSearchResponse: t.Array(chronicleSearchHit),

  searchQuery: t.Object({
    query: t.String({ minLength: 1 }),
    workspaceId: t.Optional(t.String()),
    origin: t.Optional(t.String({ minLength: 1 })),
    limit: t.Optional(t.Numeric({ minimum: 1 })),
    snippetsPerHit: t.Optional(t.Numeric({ minimum: 1 })),
  }),

  chronicleSearchQuery: t.Object({
    query: t.String({ minLength: 1 }),
    workspaceId: t.Optional(t.String()),
    limit: t.Optional(t.Numeric({ minimum: 1 })),
  }),
}
