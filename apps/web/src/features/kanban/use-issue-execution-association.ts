import type { QueryClient } from '@tanstack/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

import {
  deleteSessionsByIdLinkedIssue,
  postSessionsByIdLinkedIssue,
} from '~/api-gen/sdk.gen'
import { refreshSessionProjections } from '~/features/session/api/session-projection'
import { refreshSessionGroupProjections } from '~/features/workspace/session-group-projection'

import { kanbanKeys } from './use-kanban'

/**
 * Issue–execution association reconciliation.
 *
 * The Issue-owned server workflow returns a typed transition for every
 * association mutation — link, unlink, and relink share the same shape:
 *
 * ```ts
 * {
 *   participantKind: 'session' | 'session-group',
 *   participantId: string,
 *   previousIssueId: string | null,
 *   nextIssueId: string | null,
 * }
 * ```
 *
 * `reconcileIssueExecutionAssociation` is the single consumer of that
 * contract. It refreshes every projection the transition can touch so no
 * caller has to guess which caches changed:
 *
 * - the participant's own projections — Session detail/list/runtime/queue
 *   through the Session projection gateway, Session Group list/detail through
 *   the Session Group projection gateway;
 * - the participant's linked-issue ref (`useLinkedIssue` for sessions);
 * - the old and new Issue's linked-session and linked-session-group lists.
 *
 * Callers that know the attempted target also run it on failure with the
 * attempted ref, which returns every touched projection to a server-confirmed
 * state instead of leaving optimistic residue.
 */

export interface IssueExecutionAssociationTransition {
  participantKind: 'session' | 'session-group'
  participantId: string
  previousIssueId: string | null
  nextIssueId: string | null
}

const IssueExecutionAssociationTransitionSchema = z.object({
  participantKind: z.enum(['session', 'session-group']),
  participantId: z.string(),
  previousIssueId: z.string().nullable(),
  nextIssueId: z.string().nullable(),
}) satisfies z.ZodType<IssueExecutionAssociationTransition>

export function reconcileIssueExecutionAssociation(
  queryClient: QueryClient,
  transition: IssueExecutionAssociationTransition,
): Promise<void> {
  const tasks: Promise<unknown>[] = []

  // Participant projections, reconciled through the owning feature's API.
  if (transition.participantKind === 'session') {
    tasks.push(refreshSessionProjections(queryClient, transition.participantId))
    tasks.push(queryClient.invalidateQueries({
      queryKey: kanbanKeys.linkedIssueRef(transition.participantId),
    }))
  }
  else {
    tasks.push(refreshSessionGroupProjections(queryClient, { groupId: transition.participantId }))
  }

  // Old and new Issue projections: linked participant lists change on both
  // sides of link/unlink/relink, so both refs reconcile.
  const touchedIssueIds = new Set(
    [transition.previousIssueId, transition.nextIssueId]
      .filter((issueId): issueId is string => typeof issueId === 'string' && issueId.length > 0),
  )
  for (const issueId of touchedIssueIds) {
    tasks.push(queryClient.invalidateQueries({ queryKey: kanbanKeys.linkedSessions(issueId) }))
    tasks.push(queryClient.invalidateQueries({ queryKey: kanbanKeys.linkedSessionGroups(issueId) }))
  }

  return Promise.all(tasks).then(() => {})
}

function linkedIssueRefFor(
  queryClient: QueryClient,
  sessionId: string,
): string | null {
  const cached = queryClient.getQueryData<{ issueId: string | null } | null>(
    kanbanKeys.linkedIssueRef(sessionId),
  )
  return cached?.issueId ?? null
}

/**
 * Link or relink a Session to an Issue. The server response is the typed
 * transition, so previous and next Issue projections reconcile without
 * scanning caches.
 */
export function useLinkIssue() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { chatSessionId: string, issueId: string }) => {
      const { data } = await postSessionsByIdLinkedIssue({
        path: { id: vars.chatSessionId },
        body: { issueId: vars.issueId },
        throwOnError: true,
      })
      return IssueExecutionAssociationTransitionSchema.parse(data)
    },
    onMutate: vars => ({
      previousIssueId: linkedIssueRefFor(queryClient, vars.chatSessionId),
    }),
    onSuccess: (transition) => {
      void reconcileIssueExecutionAssociation(queryClient, transition)
    },
    onError: (_error, vars, context) => {
      // The server rejected the write — re-reconcile the participant plus the
      // recorded previous ref and the attempted target so every projection we
      // may have touched converges back to the server-confirmed state.
      void reconcileIssueExecutionAssociation(queryClient, {
        participantKind: 'session',
        participantId: vars.chatSessionId,
        previousIssueId: context?.previousIssueId ?? null,
        nextIssueId: vars.issueId,
      })
    },
  })
}

/**
 * Unlink a Session from its Issue. Same transition contract as link — the
 * previous Issue ref is only knowable from the response, which is exactly why
 * the workflow returns it.
 */
export function useUnlinkIssue() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (chatSessionId: string) => {
      const { data } = await deleteSessionsByIdLinkedIssue({
        path: { id: chatSessionId },
        throwOnError: true,
      })
      return IssueExecutionAssociationTransitionSchema.parse(data)
    },
    onMutate: chatSessionId => ({
      previousIssueId: linkedIssueRefFor(queryClient, chatSessionId),
    }),
    onSuccess: (transition) => {
      void reconcileIssueExecutionAssociation(queryClient, transition)
    },
    onError: (_error, chatSessionId, context) => {
      void reconcileIssueExecutionAssociation(queryClient, {
        participantKind: 'session',
        participantId: chatSessionId,
        previousIssueId: context?.previousIssueId ?? null,
        nextIssueId: context?.previousIssueId ?? null,
      })
    },
  })
}
