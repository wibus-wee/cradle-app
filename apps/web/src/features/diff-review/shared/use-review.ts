import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  deleteWorkspacesByWorkspaceIdDiffReviewsByReviewIdAgentFixesByAgentFixId,
  getWorkspacesByWorkspaceIdDiffReviewsByReviewId,
  postWorkspacesByWorkspaceIdDiffReviewsByReviewIdAgentFixes,
  postWorkspacesByWorkspaceIdDiffReviewsByReviewIdAgentFixesByAgentFixIdCancel,
  postWorkspacesByWorkspaceIdDiffReviewsByReviewIdAgentFixesByAgentFixIdRerun,
  postWorkspacesByWorkspaceIdDiffReviewsByReviewIdAgentFixesByAgentFixIdStart,
  postWorkspacesByWorkspaceIdDiffReviewsByReviewIdClose,
  postWorkspacesByWorkspaceIdDiffReviewsByReviewIdCommitPlansByCommitPlanIdApply,
  postWorkspacesByWorkspaceIdDiffReviewsByReviewIdFilesByFileIdViewed,
  postWorkspacesByWorkspaceIdDiffReviewsByReviewIdGuideCancel,
  postWorkspacesByWorkspaceIdDiffReviewsByReviewIdGuideGenerate,
  postWorkspacesByWorkspaceIdDiffReviewsByReviewIdRefresh,
  postWorkspacesByWorkspaceIdDiffReviewsByReviewIdSubmit,
  postWorkspacesByWorkspaceIdDiffReviewsByReviewIdThreads,
  postWorkspacesByWorkspaceIdDiffReviewsByReviewIdThreadsByThreadIdComments,
  postWorkspacesByWorkspaceIdDiffReviewsByReviewIdThreadsByThreadIdResolve,
  postWorkspacesByWorkspaceIdDiffReviewsLocalWorkingTree,
  putWorkspacesByWorkspaceIdDiffReviewsByReviewIdCommitPlansByCommitPlanId,
  putWorkspacesByWorkspaceIdDiffReviewsPreferences,
} from '~/api-gen/sdk.gen'
import type { RuntimeKind } from '~/features/agent-runtime/types'
import { queryRefreshPolicies } from '~/lib/query-refresh-policy'

import { reviewListQueryKey, reviewQueryKey } from './diff-items'
import type {
  CradleDiffReview,
  DiffStyle,
  EditableCommitPlanStatus,
  GenerateGuideInput,
  ReviewCommitPlanGroup,
  ReviewDecision,
  ReviewThreadAnchorInput,
} from './types'
import { isWorkingTreeReviewId } from './types'

export interface UseReviewArgs {
  workspaceId: string
  repositoryPath?: string | null
  reviewId: string
}

/**
 * Owns the active review document and every mutation that updates it. All mutations write the
 * fresh review back into the cache so the diff stage, threads, and rail stay in sync without a
 * refetch round-trip.
 */
export function useReview({ workspaceId, repositoryPath, reviewId }: UseReviewArgs) {
  const queryClient = useQueryClient()
  const queryKey = reviewQueryKey(workspaceId, repositoryPath, reviewId)

  const applyReview = (review: CradleDiffReview) => {
    queryClient.setQueryData(reviewQueryKey(workspaceId, review.repositoryPath, review.id), review)
    queryClient.setQueryData(queryKey, review)
  }

  const invalidateList = () => {
    void queryClient.invalidateQueries({ queryKey: reviewListQueryKey(workspaceId) })
  }

  const reviewQuery = useQuery({
    queryKey,
    queryFn: async () => {
      if (isWorkingTreeReviewId(reviewId)) {
        const { data } = await postWorkspacesByWorkspaceIdDiffReviewsLocalWorkingTree({
          path: { workspaceId },
          body: repositoryPath ? { repo: repositoryPath } : {},
          throwOnError: true,
        })
        return data
      }
      const { data } = await getWorkspacesByWorkspaceIdDiffReviewsByReviewId({
        path: { workspaceId, reviewId },
        throwOnError: true,
      })
      return data
    },
    ...queryRefreshPolicies.active,
    refetchInterval: (query) => {
      const review = query.state.data as CradleDiffReview | undefined
      const guideActive = review?.guide.status === 'pending' || review?.guide.status === 'running'
      const agentFixActive = review?.agentFixes.some(fix => fix.status === 'running') ?? false
      return guideActive || agentFixActive
        ? 1_500
        : queryRefreshPolicies.active.refetchInterval
    },
    retry: false,
  })

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const review = reviewQuery.data
      if (review?.id && !isWorkingTreeReviewId(reviewId)) {
        const { data } = await postWorkspacesByWorkspaceIdDiffReviewsByReviewIdRefresh({
          path: { workspaceId, reviewId: review.id },
          throwOnError: true,
        })
        return data
      }
      const { data } = await postWorkspacesByWorkspaceIdDiffReviewsLocalWorkingTree({
        path: { workspaceId },
        body: repositoryPath ? { repo: repositoryPath } : {},
        throwOnError: true,
      })
      return data
    },
    onSuccess: (data) => {
      applyReview(data)
      invalidateList()
    },
  })

  const viewedMutation = useMutation({
    mutationFn: async (input: { fileId: string, viewed: boolean }) => {
      const review = reviewQuery.data
      if (!review) {
        throw new Error('Review not loaded')
      }
      const { data } = await postWorkspacesByWorkspaceIdDiffReviewsByReviewIdFilesByFileIdViewed({
        path: { workspaceId, reviewId: review.id, fileId: input.fileId },
        body: { viewed: input.viewed },
        throwOnError: true,
      })
      return data
    },
    onSuccess: applyReview,
  })

  const createThreadMutation = useMutation({
    mutationFn: async (input: {
      fileId: string | null
      anchor?: ReviewThreadAnchorInput | null
      bodyMarkdown: string
    }) => {
      const review = reviewQuery.data
      if (!review) {
        throw new Error('Review not loaded')
      }
      const { data } = await postWorkspacesByWorkspaceIdDiffReviewsByReviewIdThreads({
        path: { workspaceId, reviewId: review.id },
        body: { fileId: input.fileId, anchor: input.anchor ?? null, bodyMarkdown: input.bodyMarkdown },
        throwOnError: true,
      })
      return data
    },
    onSuccess: (data) => {
      applyReview(data)
      invalidateList()
    },
  })

  const replyMutation = useMutation({
    mutationFn: async (input: { threadId: string, bodyMarkdown: string }) => {
      const review = reviewQuery.data
      if (!review) {
        throw new Error('Review not loaded')
      }
      const { data } = await postWorkspacesByWorkspaceIdDiffReviewsByReviewIdThreadsByThreadIdComments({
        path: { workspaceId, reviewId: review.id, threadId: input.threadId },
        body: { bodyMarkdown: input.bodyMarkdown },
        throwOnError: true,
      })
      return data
    },
    onSuccess: applyReview,
  })

  const resolveThreadMutation = useMutation({
    mutationFn: async (threadId: string) => {
      const review = reviewQuery.data
      if (!review) {
        throw new Error('Review not loaded')
      }
      const { data } = await postWorkspacesByWorkspaceIdDiffReviewsByReviewIdThreadsByThreadIdResolve({
        path: { workspaceId, reviewId: review.id, threadId },
        throwOnError: true,
      })
      return data
    },
    onSuccess: applyReview,
  })

  const submitMutation = useMutation({
    mutationFn: async (input: { decision: ReviewDecision, bodyMarkdown: string }) => {
      const review = reviewQuery.data
      if (!review) {
        throw new Error('Review not loaded')
      }
      const { data } = await postWorkspacesByWorkspaceIdDiffReviewsByReviewIdSubmit({
        path: { workspaceId, reviewId: review.id },
        body: { decision: input.decision, bodyMarkdown: input.bodyMarkdown || null },
        throwOnError: true,
      })
      return data
    },
    onSuccess: (data) => {
      applyReview(data)
      invalidateList()
    },
  })

  const closeReviewMutation = useMutation({
    mutationFn: async () => {
      const review = reviewQuery.data
      if (!review) {
        throw new Error('Review not loaded')
      }
      const { data } = await postWorkspacesByWorkspaceIdDiffReviewsByReviewIdClose({
        path: { workspaceId, reviewId: review.id },
        throwOnError: true,
      })
      return data
    },
    onSuccess: (data) => {
      applyReview(data)
      invalidateList()
    },
  })

  const preferenceMutation = useMutation({
    mutationFn: async (input: {
      diffStyle?: DiffStyle
      fontSize?: number
      hideWhitespaceOnly?: boolean
      collapseGeneratedFiles?: boolean
      lineHeight?: number
    }) => {
      const { data } = await putWorkspacesByWorkspaceIdDiffReviewsPreferences({
        path: { workspaceId },
        body: input,
        throwOnError: true,
      })
      return data
    },
    onSuccess: (preferences) => {
      const review = reviewQuery.data
      if (review) {
        applyReview({ ...review, preferences })
      }
    },
  })

  const commitPlanUpdateMutation = useMutation({
    mutationFn: async (input: {
      planId: string
      groups: ReviewCommitPlanGroup[]
      rationale: string
      status: EditableCommitPlanStatus
    }) => {
      const review = reviewQuery.data
      if (!review) {
        throw new Error('Review not loaded')
      }
      const { data } = await putWorkspacesByWorkspaceIdDiffReviewsByReviewIdCommitPlansByCommitPlanId({
        path: { workspaceId, reviewId: review.id, commitPlanId: input.planId },
        body: {
          groups: input.groups.map(group => ({
            id: group.id,
            title: group.title,
            message: group.message,
            rationale: group.rationale,
            fileIds: group.fileIds,
            paths: group.paths,
            dependsOn: group.dependsOn,
          })),
          rationale: input.rationale,
          status: input.status,
        },
        throwOnError: true,
      })
      return data
    },
    onSuccess: (data) => {
      applyReview(data)
      invalidateList()
    },
  })

  const commitPlanApplyMutation = useMutation({
    mutationFn: async (planId: string) => {
      const review = reviewQuery.data
      if (!review) {
        throw new Error('Review not loaded')
      }
      const { data } = await postWorkspacesByWorkspaceIdDiffReviewsByReviewIdCommitPlansByCommitPlanIdApply({
        path: { workspaceId, reviewId: review.id, commitPlanId: planId },
        body: {},
        throwOnError: true,
      })
      return data
    },
    onSuccess: (data) => {
      applyReview(data)
      invalidateList()
    },
  })

  const createAgentFixMutation = useMutation({
    mutationFn: async (input: {
      threadId?: string | null
      anchor?: ReviewThreadAnchorInput | null
      instruction: string
      agentId?: string | null
      expectedOutput: 'commit' | 'working-tree-change' | 'patch-artifact'
    }) => {
      const review = reviewQuery.data
      if (!review) {
        throw new Error('Review not loaded')
      }
      const { data } = await postWorkspacesByWorkspaceIdDiffReviewsByReviewIdAgentFixes({
        path: { workspaceId, reviewId: review.id },
        body: {
          threadId: input.threadId ?? null,
          anchor: input.anchor ?? null,
          instruction: input.instruction,
          agentId: input.agentId ?? null,
          expectedOutput: input.expectedOutput,
        },
        throwOnError: true,
      })
      return data
    },
    onSuccess: (data) => {
      applyReview(data)
      invalidateList()
    },
  })

  const startAgentFixMutation = useMutation({
    mutationFn: async (input: {
      agentFixId: string
      agentId?: string | null
      providerTargetId?: string | null
      runtimeKind?: RuntimeKind | null
      modelId?: string | null
    }) => {
      const review = reviewQuery.data
      if (!review) {
        throw new Error('Review not loaded')
      }
      const { data } = await postWorkspacesByWorkspaceIdDiffReviewsByReviewIdAgentFixesByAgentFixIdStart({
        path: { workspaceId, reviewId: review.id, agentFixId: input.agentFixId },
        body: {
          agentId: input.agentId ?? null,
          providerTargetId: input.providerTargetId ?? null,
          runtimeKind: input.runtimeKind ?? null,
          modelId: input.modelId ?? null,
        },
        throwOnError: true,
      })
      return data
    },
    onSuccess: (data) => {
      applyReview(data)
      invalidateList()
    },
  })

  const cancelAgentFixMutation = useMutation({
    mutationFn: async (agentFixId: string) => {
      const review = reviewQuery.data
      if (!review) {
        throw new Error('Review not loaded')
      }
      const { data } = await postWorkspacesByWorkspaceIdDiffReviewsByReviewIdAgentFixesByAgentFixIdCancel({
        path: { workspaceId, reviewId: review.id, agentFixId },
        body: {},
        throwOnError: true,
      })
      return data
    },
    onSuccess: (data) => {
      applyReview(data)
      invalidateList()
    },
  })

  const rerunAgentFixMutation = useMutation({
    mutationFn: async (input: {
      agentFixId: string
      agentId?: string | null
      providerTargetId?: string | null
      runtimeKind?: RuntimeKind | null
      modelId?: string | null
    }) => {
      const review = reviewQuery.data
      if (!review) {
        throw new Error('Review not loaded')
      }
      const { data } = await postWorkspacesByWorkspaceIdDiffReviewsByReviewIdAgentFixesByAgentFixIdRerun({
        path: { workspaceId, reviewId: review.id, agentFixId: input.agentFixId },
        body: {
          agentId: input.agentId ?? null,
          providerTargetId: input.providerTargetId ?? null,
          runtimeKind: input.runtimeKind ?? null,
          modelId: input.modelId ?? null,
        },
        throwOnError: true,
      })
      return data
    },
    onSuccess: (data) => {
      applyReview(data)
      invalidateList()
    },
  })

  const deleteAgentFixMutation = useMutation({
    mutationFn: async (agentFixId: string) => {
      const review = reviewQuery.data
      if (!review) {
        throw new Error('Review not loaded')
      }
      const { data } = await deleteWorkspacesByWorkspaceIdDiffReviewsByReviewIdAgentFixesByAgentFixId({
        path: { workspaceId, reviewId: review.id, agentFixId },
        throwOnError: true,
      })
      return data
    },
    onSuccess: (data) => {
      applyReview(data)
      invalidateList()
    },
  })

  /**
   * On-demand change walkthrough generation. This spends tokens, so it is strictly user-initiated —
   * never auto-triggered. `force` re-generates over an existing guide.
   */
  const generateGuideMutation = useMutation({
    mutationFn: async (input: GenerateGuideInput) => {
      const review = reviewQuery.data
      if (!review) {
        throw new Error('Review not loaded')
      }
      const { data } = await postWorkspacesByWorkspaceIdDiffReviewsByReviewIdGuideGenerate({
        path: { workspaceId, reviewId: review.id },
        body: {
          providerTargetId: input.providerTargetId,
          runtimeKind: input.runtimeKind,
          modelId: input.modelId ?? null,
          force: input.force,
        },
        throwOnError: true,
      })
      return data
    },
    onSuccess: (data) => {
      applyReview(data)
      invalidateList()
    },
  })

  const cancelGuideMutation = useMutation({
    mutationFn: async () => {
      const review = reviewQuery.data
      if (!review) {
        throw new Error('Review not loaded')
      }
      const { data } = await postWorkspacesByWorkspaceIdDiffReviewsByReviewIdGuideCancel({
        path: { workspaceId, reviewId: review.id },
        throwOnError: true,
      })
      return data
    },
    onSuccess: (data) => {
      applyReview(data)
      invalidateList()
    },
  })

  return {
    review: reviewQuery.data ?? null,
    isLoading: reviewQuery.isLoading,
    isFetching: reviewQuery.isFetching,
    isError: reviewQuery.isError,
    refreshMutation,
    viewedMutation,
    createThreadMutation,
    replyMutation,
    resolveThreadMutation,
    submitMutation,
    closeReviewMutation,
    preferenceMutation,
    commitPlanUpdateMutation,
    commitPlanApplyMutation,
    createAgentFixMutation,
    startAgentFixMutation,
    cancelAgentFixMutation,
    rerunAgentFixMutation,
    deleteAgentFixMutation,
    generateGuideMutation,
    cancelGuideMutation,
  }
}
