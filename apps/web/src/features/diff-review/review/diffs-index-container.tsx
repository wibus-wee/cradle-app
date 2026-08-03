import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  getWorkspacesByWorkspaceIdDiffReviews,
  getWorkspacesByWorkspaceIdGitRepositories,
  postWorkspacesByWorkspaceIdDiffReviewsGithubPullRequest,
} from '~/api-gen/sdk.gen'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { toastManager } from '~/components/ui/toast'
import type { GitRepository } from '~/features/git/shared/types'
import { useWorkspaces } from '~/features/workspace/use-workspace'
import { queryRefreshPolicies } from '~/lib/query-refresh-policy'
import { router } from '~/router'

import {
  parseGitHubPullRequestReference,
} from '../github-pull-request-reference'
import { reviewListQueryKey } from '../shared/diff-items'
import { navigateToReview, WORKING_TREE_REVIEW_ID } from '../shared/navigation'
import type { CradleDiffReview } from '../shared/types'
import type { RepositoryScope } from './diffs-index-view'
import { DiffsIndexView } from './diffs-index-view'

type DiffReviewKey = keyof typeof import('~/locales/default').default['diff-review']

export interface DiffsIndexContainerProps {
  /**
   * When set, only repositories/reviews from this workspace are listed
   * (embedded `/workspaces/$id/diffs` surface).
   */
  workspaceId?: string
  /** Prefer this workspace when choosing a default repository selection. */
  preferredWorkspaceId?: string
  /** Pre-select a repository by local path or `owner/repo` label. */
  selectedRepositoryKey?: string
}

interface WorkspaceBundle {
  workspaceId: string
  workspaceName: string
  repositories: GitRepository[]
  reviews: CradleDiffReview[]
}

function repositoryScopeId(input: {
  workspaceId: string
  hostKind: 'github' | 'local'
  label: string
  repositoryPath: string | null
}): string {
  if (input.hostKind === 'github') {
    return `github:${input.label}`
  }
  return `local:${input.workspaceId}:${input.repositoryPath ?? '.'}`
}

function reviewRepositoryKey(review: CradleDiffReview): {
  hostKind: 'github' | 'local'
  label: string
  repositoryPath: string | null
} {
  if (review.githubPullRequest) {
    return {
      hostKind: 'github',
      label: `${review.githubPullRequest.owner}/${review.githubPullRequest.repo}`,
      repositoryPath: review.repositoryPath === '.' ? '.' : review.repositoryPath,
    }
  }
  const path = review.repositoryPath
  const label = path === '.' || path === ''
    ? 'Workspace root'
    : path.includes('/')
      ? path.slice(path.lastIndexOf('/') + 1)
      : path
  return {
    hostKind: 'local',
    label,
    repositoryPath: path === '' ? '.' : path,
  }
}

function buildRepositoryScopes(bundles: WorkspaceBundle[]): {
  repositories: RepositoryScope[]
  reviewsByRepositoryId: Map<string, CradleDiffReview[]>
} {
  const scopes = new Map<string, RepositoryScope>()
  const reviewsByRepositoryId = new Map<string, CradleDiffReview[]>()

  const ensure = (input: {
    workspaceId: string
    hostKind: 'github' | 'local'
    label: string
    localRoot: string | null
    repositoryPath: string | null
  }): RepositoryScope => {
    const id = repositoryScopeId(input)
    const existing = scopes.get(id)
    if (existing) {
      // Prefer a concrete checkout path when a later bundle supplies one.
      if (!existing.localRoot && input.localRoot) {
        existing.localRoot = input.localRoot
      }
      if (existing.repositoryPath == null && input.repositoryPath != null) {
        existing.repositoryPath = input.repositoryPath
      }
      return existing
    }
    const created: RepositoryScope = {
      id,
      hostKind: input.hostKind,
      label: input.label,
      localRoot: input.localRoot,
      reviewCount: 0,
      workspaceId: input.workspaceId,
      repositoryPath: input.repositoryPath,
    }
    scopes.set(id, created)
    reviewsByRepositoryId.set(id, [])
    return created
  }

  for (const bundle of bundles) {
    for (const repository of bundle.repositories) {
      ensure({
        workspaceId: bundle.workspaceId,
        hostKind: 'local',
        label: repository.name,
        localRoot: repository.absolutePath,
        repositoryPath: repository.path === '' ? '.' : repository.path,
      })
    }

    for (const review of bundle.reviews) {
      const key = reviewRepositoryKey(review)
      const localMatch = bundle.repositories.find((repository) => {
        const path = repository.path === '' ? '.' : repository.path
        if (key.hostKind === 'github') {
          // Fold GitHub reviews onto a same-named local checkout so the index
          // does not list the same code identity twice.
          const repoName = key.label.split('/')[1] ?? key.label
          return repository.name === repoName || repository.name === key.label
        }
        return path === key.repositoryPath || repository.name === key.label
      })

      if (localMatch) {
        const path = localMatch.path === '' ? '.' : localMatch.path
        // Always key off the local checkout id so PRs attach to the row that
        // already represents this working tree.
        const scope = ensure({
          workspaceId: bundle.workspaceId,
          hostKind: 'local',
          label: localMatch.name,
          localRoot: localMatch.absolutePath,
          repositoryPath: path,
        })
        if (key.hostKind === 'github') {
          scope.hostKind = 'github'
          scope.label = key.label
        }
        const list = reviewsByRepositoryId.get(scope.id) ?? []
        list.push(review)
        reviewsByRepositoryId.set(scope.id, list)
        continue
      }

      const scope = ensure({
        workspaceId: bundle.workspaceId,
        hostKind: key.hostKind,
        label: key.label,
        localRoot: null,
        repositoryPath: key.repositoryPath,
      })
      const list = reviewsByRepositoryId.get(scope.id) ?? []
      list.push(review)
      reviewsByRepositoryId.set(scope.id, list)
    }
  }

  for (const [id, reviews] of reviewsByRepositoryId) {
    const scope = scopes.get(id)
    if (scope) {
      scope.reviewCount = reviews.length
    }
  }

  const repositories = [...scopes.values()].toSorted((left, right) => {
    if (right.reviewCount !== left.reviewCount) {
      return right.reviewCount - left.reviewCount
    }
    return left.label.localeCompare(right.label)
  })

  for (const [id, reviews] of reviewsByRepositoryId) {
    reviewsByRepositoryId.set(
      id,
      [...reviews].toSorted((left, right) => right.updatedAt - left.updatedAt),
    )
  }

  return { repositories, reviewsByRepositoryId }
}

function matchRepositoryKey(
  repositories: RepositoryScope[],
  key: string | undefined,
): string | null {
  if (!key) {
    return null
  }
  const match = repositories.find(repository => (
    repository.id === key
    || repository.label === key
    || repository.repositoryPath === key
    || repository.id === `github:${key}`
    || repository.id.endsWith(`:${key}`)
  ))
  return match?.id ?? null
}

/**
 * Production container for the repository-first Diffs index.
 *
 * Derives `RepositoryScope` from each workspace's git checkouts and reviews
 * until first-class repository ownership lands on the server.
 */
export function DiffsIndexContainer({
  workspaceId,
  preferredWorkspaceId,
  selectedRepositoryKey,
}: DiffsIndexContainerProps) {
  const { workspaces, loading: workspacesLoading } = useWorkspaces()
  const queryClient = useQueryClient()
  const [selectedRepositoryId, setSelectedRepositoryId] = useState<string | null>(null)
  const [addPullRequestOpen, setAddPullRequestOpen] = useState(false)

  const scopedWorkspaces = useMemo(() => {
    if (!workspaceId) {
      return workspaces
    }
    return workspaces.filter(workspace => workspace.id === workspaceId)
  }, [workspaceId, workspaces])

  const workspaceQueries = useQueries({
    queries: scopedWorkspaces.map(workspace => ({
      queryKey: ['diffs-index-bundle', workspace.id] as const,
      queryFn: async (): Promise<WorkspaceBundle> => {
        const [reviewsResult, repositoriesResult] = await Promise.all([
          getWorkspacesByWorkspaceIdDiffReviews({
            path: { workspaceId: workspace.id },
            throwOnError: true,
          }),
          getWorkspacesByWorkspaceIdGitRepositories({
            path: { workspaceId: workspace.id },
            throwOnError: true,
          }),
        ])
        return {
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          reviews: reviewsResult.data ?? [],
          repositories: repositoriesResult.data ?? [],
        }
      },
      ...queryRefreshPolicies.active,
      retry: false,
    })),
  })

  const bundles = useMemo(
    () => workspaceQueries.flatMap(query => (query.data ? [query.data] : [])),
    [workspaceQueries],
  )

  const loading = workspacesLoading || workspaceQueries.some(query => query.isLoading || query.isPending)

  const { repositories, reviewsByRepositoryId } = useMemo(
    () => buildRepositoryScopes(bundles),
    [bundles],
  )

  useEffect(() => {
    if (repositories.length === 0) {
      setSelectedRepositoryId(null)
      return
    }
    const fromKey = matchRepositoryKey(repositories, selectedRepositoryKey)
    if (fromKey) {
      setSelectedRepositoryId(fromKey)
      return
    }
    setSelectedRepositoryId((current) => {
      if (current && repositories.some(repository => repository.id === current)) {
        return current
      }
      const preferredId = preferredWorkspaceId ?? workspaceId
      const preferred = preferredId
        ? repositories.find(repository => repository.workspaceId === preferredId)
        : null
      return preferred?.id ?? repositories[0]!.id
    })
  }, [preferredWorkspaceId, repositories, selectedRepositoryKey, workspaceId])

  const selectedRepository = repositories.find(repository => repository.id === selectedRepositoryId) ?? null
  const reviews = selectedRepository
    ? (reviewsByRepositoryId.get(selectedRepository.id) ?? [])
    : []

  const pullRequestMutation = useMutation({
    mutationFn: async (input: { workspaceId: string, owner: string, repo: string, number: number }) => {
      const { data } = await postWorkspacesByWorkspaceIdDiffReviewsGithubPullRequest({
        path: { workspaceId: input.workspaceId },
        body: { owner: input.owner, repo: input.repo, number: input.number },
        throwOnError: true,
      })
      return { review: data, workspaceId: input.workspaceId }
    },
    onSuccess: ({ review, workspaceId: targetWorkspaceId }) => {
      void queryClient.invalidateQueries({ queryKey: reviewListQueryKey(targetWorkspaceId) })
      void queryClient.invalidateQueries({ queryKey: ['diffs-index-bundle', targetWorkspaceId] })
      navigateToReview(targetWorkspaceId, review.id)
    },
    onError: (error: Error) => toastManager.add({
      type: 'error',
      title: 'Open pull request failed',
      description: error.message,
    }),
  })

  const selectRepository = (repositoryId: string) => {
    setSelectedRepositoryId(repositoryId)
    const repository = repositories.find(item => item.id === repositoryId)
    if (!repository) {
      return
    }
    const repo = repository.repositoryPath && repository.repositoryPath !== '.'
      ? repository.repositoryPath
      : undefined

    if (router.state.location.pathname === '/diff') {
      void router.navigate({
        to: '/diff',
        search: {
          workspace: repository.workspaceId,
          repo,
        },
      })
      return
    }

    void router.navigate({
      to: '/workspaces/$workspaceId/diffs',
      params: { workspaceId: repository.workspaceId },
      search: { repo },
    })
  }

  return (
    <div className="h-full min-h-0 w-full overflow-hidden">
      <DiffsIndexView
        repositories={repositories}
        selectedRepositoryId={selectedRepositoryId}
        onSelectRepository={selectRepository}
        reviews={reviews}
        loading={loading}
        onOpenReview={(review) => {
          navigateToReview(review.workspaceId, review.id, {
            repositoryPath: review.repositoryPath,
          })
        }}
        onOpenWorkingTree={selectedRepository
          ? () => {
              navigateToReview(selectedRepository.workspaceId, WORKING_TREE_REVIEW_ID, {
                repositoryPath: selectedRepository.repositoryPath,
              })
            }
          : undefined}
        onAddPullRequest={selectedRepository
          ? () => setAddPullRequestOpen(true)
          : undefined}
      />

      {selectedRepository && (
        <AddPullRequestDialog
          open={addPullRequestOpen}
          onOpenChange={setAddPullRequestOpen}
          pending={pullRequestMutation.isPending}
          onOpen={(input) => {
            pullRequestMutation.mutate({
              workspaceId: selectedRepository.workspaceId,
              ...input,
            })
          }}
        />
      )}
    </div>
  )
}

function AddPullRequestDialog({
  open,
  onOpenChange,
  pending,
  onOpen,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pending: boolean
  onOpen: (input: { owner: string, repo: string, number: number }) => void
}) {
  const { t } = useTranslation('diff-review')
  const [value, setValue] = useState('')
  const reference = useMemo(() => parseGitHubPullRequestReference(value), [value])

  const reset = () => setValue('')
  const submit = () => {
    if (!reference || pending) {
      return
    }
    onOpen(reference)
    onOpenChange(false)
    reset()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) {
          reset()
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('reviews.pullRequest.title' as DiffReviewKey)}</DialogTitle>
          <DialogDescription>
            {t('reviews.pullRequest.placeholder' as DiffReviewKey)}
          </DialogDescription>
        </DialogHeader>
        <Input
          value={value}
          onChange={event => setValue(event.target.value)}
          autoFocus
          placeholder={t('reviews.pullRequest.placeholder' as DiffReviewKey)}
          aria-label={t('reviews.pullRequest.title' as DiffReviewKey)}
          className="h-8 text-[12px]"
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              submit()
            }
          }}
        />
        {value.trim() && !reference && (
          <p className="text-[11px] text-destructive">
            {t('reviews.pullRequest.invalid' as DiffReviewKey)}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" size="sm" className="h-7 text-[12px]" onClick={() => onOpenChange(false)}>
            {t('reviews.cancel' as DiffReviewKey)}
          </Button>
          <Button size="sm" className="h-7 text-[12px]" disabled={!reference || pending} onClick={submit}>
            {pending && <Spinner className="size-3.5" />}
            {t('reviews.openAction' as DiffReviewKey)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
