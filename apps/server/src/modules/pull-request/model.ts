import { t } from 'elysia'

const nullableString = t.Nullable(t.String())

export const pullRequestViewSchema = t.Object({
  owner: t.String(),
  repo: t.String(),
  number: t.Number(),
  url: t.String(),
  title: t.String(),
  isDraft: t.Boolean(),
  state: t.Union([t.Literal('open'), t.Literal('closed')]),
  merged: t.Boolean(),
  headRef: t.String(),
  baseRef: t.String(),
  headSha: nullableString,
  createdAt: t.Number(),
  updatedAt: t.Number(),
})

export const PullRequestModel = {
  idParams: t.Object({
    id: t.String({ minLength: 1 }),
  }),

  createBody: t.Object({
    title: t.String({ minLength: 1 }),
    body: t.Optional(t.String()),
    base: t.Optional(t.String({ minLength: 1 })),
  }),

  pullRequestView: pullRequestViewSchema,

  getResponse: t.Object({
    pullRequest: t.Nullable(pullRequestViewSchema),
  }),

  mutationResponse: t.Object({
    pullRequest: pullRequestViewSchema,
  }),
}
