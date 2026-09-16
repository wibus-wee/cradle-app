import { z } from 'zod'

import {
  getSessionsByIdPullRequest,
  postSessionsByIdPullRequestReady,
} from '~/api-gen/sdk.gen'

const SessionPullRequestSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  number: z.number(),
  url: z.string(),
  title: z.string(),
  isDraft: z.boolean(),
  state: z.enum(['open', 'closed']),
  merged: z.boolean(),
  headRef: z.string(),
  baseRef: z.string(),
  headSha: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

const SessionPullRequestEnvelopeSchema = z.object({
  pullRequest: SessionPullRequestSchema.nullable(),
})

export type SessionPullRequest = z.infer<typeof SessionPullRequestSchema>

export function sessionPullRequestQueryKey(sessionId: string) {
  return ['session', sessionId, 'pull-request'] as const
}

export async function readSessionPullRequest(
  sessionId: string,
  signal?: AbortSignal,
): Promise<SessionPullRequest | null> {
  const { data } = await getSessionsByIdPullRequest({
    path: { id: sessionId },
    signal,
    throwOnError: true,
  })
  return SessionPullRequestEnvelopeSchema.parse(data).pullRequest
}

export async function markSessionPullRequestReady(sessionId: string): Promise<SessionPullRequest> {
  const { data } = await postSessionsByIdPullRequestReady({
    path: { id: sessionId },
    throwOnError: true,
  })
  const pullRequest = SessionPullRequestEnvelopeSchema.parse(data).pullRequest
  if (!pullRequest) {
    throw new Error('Mark-ready response did not include a pull request.')
  }
  return pullRequest
}
