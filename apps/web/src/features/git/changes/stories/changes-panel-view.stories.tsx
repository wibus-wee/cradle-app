import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import type { GitRepository } from '../../shared/types'
import {
  gitChangesRepositoriesFixture,
  gitChangesRepositoryFixture,
  gitCleanRepositoryFixture,
} from '../fixtures/git-changes'
import { groupGitFileStatuses } from '../lib/changes-grouping'
import type {
  ChangesPanelStatus,
  ChangesViewMode,
} from '../views/changes-panel-view'
import { ChangesPanelView } from '../views/changes-panel-view'
import { ChangesTreeView } from '../views/changes-tree-view'
import { ChangesTypeView } from '../views/changes-type-view'

interface ChangesStorySceneProps {
  status?: ChangesPanelStatus
  repositoryMode?: 'none' | 'clean' | 'single' | 'multiple'
  initialViewMode?: ChangesViewMode
}

const handleFileClick = fn()
const handleReviewRepository = fn()
const handleRenameError = fn()
const handleCreateError = fn()

function ChangesStoryScene({
  status = 'ready',
  repositoryMode = 'single',
  initialViewMode = 'type',
}: ChangesStorySceneProps) {
  const repositories: GitRepository[] = repositoryMode === 'none'
    ? []
    : repositoryMode === 'clean'
      ? [gitCleanRepositoryFixture]
      : repositoryMode === 'multiple'
        ? gitChangesRepositoriesFixture
        : [gitChangesRepositoryFixture]

  return (
    <aside className="flex h-screen min-h-[30rem] w-full max-w-[26rem] flex-col overflow-hidden border-r border-border bg-background text-foreground">
      <ChangesPanelView
        status={status}
        repositories={repositories}
        initialViewMode={initialViewMode}
        onReviewRepository={handleReviewRepository}
        renderRepositoryChanges={(repository, viewMode) => (
          viewMode === 'tree'
            ? (
              <ChangesTreeView
                files={repository.files}
                workspacePath="/Users/alex/Developer/cradle-app"
                revealInExplorer={false}
                onFileClick={handleFileClick}
                onRename={async () => {}}
                onRenameError={handleRenameError}
                onCreate={async ({ parentPath, name }) =>
                  [parentPath, name].filter(Boolean).join('/')}
                onCreateError={handleCreateError}
                onCopyAbsolutePath={async () => {}}
                onCopyRelativePath={async () => {}}
                onOpen={() => {}}
                onOpenDefault={async () => {}}
                onReveal={async () => {}}
              />
              )
            : (
              <ChangesTypeView
                sections={groupGitFileStatuses(repository.files)}
                onFileClick={handleFileClick}
              />
              )
        )}
      />
    </aside>
  )
}

const meta = {
  title: 'App/Git/Changes',
  component: ChangesStoryScene,
  parameters: {
    layout: 'fullscreen',
    controls: { disable: true },
  },
} satisfies Meta<typeof ChangesStoryScene>

export default meta

type Story = StoryObj<typeof meta>

export const ByType: Story = {}

export const AsTree: Story = {
  args: {
    initialViewMode: 'tree',
  },
}

export const MultipleRepositories: Story = {
  args: {
    repositoryMode: 'multiple',
  },
}

export const MultipleRepositoryTrees: Story = {
  args: {
    repositoryMode: 'multiple',
    initialViewMode: 'tree',
  },
}

export const CleanWorkingTree: Story = {
  args: {
    repositoryMode: 'clean',
  },
}

export const NoRepositories: Story = {
  args: {
    repositoryMode: 'none',
  },
}

export const EmptyWorkspace: Story = {
  args: {
    status: 'empty-workspace',
  },
}

export const Loading: Story = {
  args: {
    status: 'loading',
  },
}

export const Error: Story = {
  args: {
    status: 'error',
  },
}
