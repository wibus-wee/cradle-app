import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'

import type { CradleDiffReview } from '../../shared/types'
import type { RepositoryScope } from '../diffs-index-view'
import { DiffsIndexView } from '../diffs-index-view'
import { reviewFixture, workingTreeReviewFixture } from '../fixtures/review-fixtures'

const repositories: RepositoryScope[] = [
  { id: 'repo_cradle', hostKind: 'github', label: 'wibus-wee/cradle-app', localRoot: '/Users/wibus/dev/cradle-app', reviewCount: 6, workspaceId: 'ws_cradle_app', repositoryPath: '.' },
  { id: 'repo_streamdown', hostKind: 'github', label: 'wibus-wee/streamdown', localRoot: null, reviewCount: 2, workspaceId: 'ws_cradle_app', repositoryPath: null },
  { id: 'repo_scratch', hostKind: 'local', label: 'scratch', localRoot: '/Users/wibus/dev/scratch', reviewCount: 1, workspaceId: 'ws_scratch', repositoryPath: '.' },
]

/** A handful of reviews spanning states so the tab counts and columns are exercised. */
function makeReviews(): CradleDiffReview[] {
  const now = Math.floor(Date.now() / 1000)
  const merged: CradleDiffReview = {
    ...reviewFixture,
    id: 'review_merged',
    status: 'merged',
    reviewState: 'approved',
    threads: [],
    title: 'wibus-wee/cradle-app#84 Coordinate provider credential refreshes',
    githubPullRequest: {
      ...reviewFixture.githubPullRequest!,
      number: 84,
      detail: { ...reviewFixture.githubPullRequest!.detail!, title: 'Coordinate provider credential refreshes', isDraft: false, headRef: 'feat/provider-auth' },
    },
    updatedAt: now - 86_400,
  }
  const draft: CradleDiffReview = {
    ...reviewFixture,
    id: 'review_draft',
    reviewState: 'unreviewed',
    title: 'wibus-wee/cradle-app#89 Clean managed worktrees on archive',
    githubPullRequest: {
      ...reviewFixture.githubPullRequest!,
      number: 89,
      detail: { ...reviewFixture.githubPullRequest!.detail!, title: 'Clean managed worktrees on archive', isDraft: true, headRef: 'feat/worktree-cleanup', checks: [] },
    },
    threads: [],
    updatedAt: now - 5_400,
  }
  return [reviewFixture, draft, workingTreeReviewFixture, merged]
}

function DiffsIndexScene() {
  const [selected, setSelected] = useState('repo_cradle')
  return (
    <div className="h-screen w-full">
      <DiffsIndexView
        repositories={repositories}
        selectedRepositoryId={selected}
        onSelectRepository={setSelected}
        reviews={selected === 'repo_cradle' ? makeReviews() : []}
        onOpenReview={() => {}}
        onOpenWorkingTree={() => {}}
        onAddPullRequest={() => {}}
      />
    </div>
  )
}

const meta = {
  title: 'Diffs/DiffsIndexView',
  component: DiffsIndexScene,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof DiffsIndexScene>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}
