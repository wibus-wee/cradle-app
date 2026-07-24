import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { computeGraphLayout } from '../../shared/graph-layout'
import type { GitRepository } from '../../shared/types'
import {
  gitGraphCommitsFixture,
  gitRepositoriesFixture,
  gitRepositoryFixture,
} from '../fixtures/git-history'
import { GitPanelView } from '../views/git-panel-view'
import { GitRepositoryPanelSectionView } from '../views/git-repository-panel-section-view'

interface GitHistoryStorySceneProps {
  panelState?: 'empty-workspace' | 'loading' | 'error' | 'ready'
  repositoryMode?: 'none' | 'single' | 'multiple'
  graphState?: 'loading' | 'error' | 'ready'
  emptyGraph?: boolean
  graphFetching?: boolean
  fetchPending?: boolean
}

const handleFetch = fn()
const handleLoadMore = fn()

function GitHistoryStoryScene({
  panelState = 'ready',
  repositoryMode = 'single',
  graphState = 'ready',
  emptyGraph = false,
  graphFetching = false,
  fetchPending = false,
}: GitHistoryStorySceneProps) {
  const repositories: GitRepository[] = repositoryMode === 'none'
    ? []
    : repositoryMode === 'multiple'
      ? gitRepositoriesFixture
      : [gitRepositoryFixture]
  const commits = emptyGraph
    ? []
    : computeGraphLayout(gitGraphCommitsFixture)

  return (
    <aside className="flex h-screen min-h-[30rem] w-full max-w-[26rem] flex-col overflow-hidden border-r border-border bg-background text-foreground">
      <GitPanelView
        status={panelState}
        repositories={repositories}
        renderRepository={(repository, showRepositoryHeader) => (
          <GitRepositoryPanelSectionView
            repository={repository}
            showRepositoryHeader={showRepositoryHeader}
            commits={commits}
            graphStatus={graphState}
            graphFetching={graphFetching}
            fetchPending={fetchPending}
            renderBranchPicker={trigger => trigger}
            onFetch={handleFetch}
            onLoadMore={handleLoadMore}
          />
        )}
      />
    </aside>
  )
}

const meta = {
  title: 'App/Git/Git History',
  component: GitHistoryStoryScene,
  parameters: {
    layout: 'fullscreen',
    controls: { disable: true },
  },
} satisfies Meta<typeof GitHistoryStoryScene>

export default meta

type Story = StoryObj<typeof meta>

export const History: Story = {}

export const MultipleRepositories: Story = {
  args: {
    repositoryMode: 'multiple',
  },
}

export const EmptyWorkspace: Story = {
  args: {
    panelState: 'empty-workspace',
  },
}

export const LoadingRepositories: Story = {
  args: {
    panelState: 'loading',
  },
}

export const RepositoryError: Story = {
  args: {
    panelState: 'error',
  },
}

export const NoRepositories: Story = {
  args: {
    repositoryMode: 'none',
  },
}

export const LoadingGraph: Story = {
  args: {
    graphState: 'loading',
  },
}

export const GraphError: Story = {
  args: {
    graphState: 'error',
  },
}

export const EmptyGraph: Story = {
  args: {
    emptyGraph: true,
  },
}

export const FetchingMore: Story = {
  args: {
    graphFetching: true,
  },
}

export const FetchingRemote: Story = {
  args: {
    fetchPending: true,
  },
}
