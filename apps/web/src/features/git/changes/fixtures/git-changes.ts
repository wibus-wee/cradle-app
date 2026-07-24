import type { GitFileStatus, GitRepository } from '../../shared/types'

export const gitChangesFilesFixture: GitFileStatus[] = [
  {
    path: 'apps/web/src/features/git/changes/views/changes-panel-view.tsx',
    workspacePath: 'apps/web/src/features/git/changes/views/changes-panel-view.tsx',
    status: 'added',
  },
  {
    path: 'apps/web/src/features/chat/chat-view.tsx',
    workspacePath: 'apps/web/src/features/chat/chat-view.tsx',
    status: 'modified',
  },
  {
    path: 'apps/web/src/features/git/changes/legacy-changes-panel.tsx',
    workspacePath: 'apps/web/src/features/git/changes/legacy-changes-panel.tsx',
    status: 'deleted',
  },
  {
    path: 'apps/web/src/components/common/workspace-file-row.tsx',
    workspacePath: 'apps/web/src/components/common/workspace-file-row.tsx',
    status: 'renamed',
  },
  {
    path: 'apps/web/src/features/git/changes/views/changes-tree-view.tsx',
    workspacePath: 'apps/web/src/features/git/changes/views/changes-tree-view.tsx',
    status: 'untracked',
  },
  {
    path: 'docs/component-architecture.md',
    workspacePath: 'docs/component-architecture.md',
    status: 'modified',
  },
  {
    path: 'README.md',
    workspacePath: 'README.md',
    status: 'modified',
  },
  {
    path: 'apps/web/src/features/git/changes/changes-panel.test.ts',
    workspacePath: 'apps/web/src/features/git/changes/changes-panel.test.ts',
    status: 'modified',
  },
  {
    path: 'apps/web/src/features/git/changes/lib/changes-paths.test.ts',
    workspacePath: 'apps/web/src/features/git/changes/lib/changes-paths.test.ts',
    status: 'added',
  },
]

export const gitChangesRepositoryFixture = {
  path: '.',
  name: 'cradle-app',
  absolutePath: '/Users/alex/Developer/cradle-app',
  branch: 'feature/component-views',
  tracking: 'origin/feature/component-views',
  ahead: 4,
  behind: 0,
  isDetached: false,
  files: gitChangesFilesFixture,
} satisfies GitRepository

export const gitPluginChangesRepositoryFixture = {
  path: 'packages/plugin-sdk',
  name: 'plugin-sdk',
  absolutePath: '/Users/alex/Developer/cradle-app/packages/plugin-sdk',
  branch: 'release/plugin-runtime',
  tracking: 'origin/release/plugin-runtime',
  ahead: 1,
  behind: 2,
  isDetached: false,
  files: [
    {
      path: 'src/browser-panel.ts',
      workspacePath: 'packages/plugin-sdk/src/browser-panel.ts',
      status: 'modified',
    },
    {
      path: 'src/render-slots.ts',
      workspacePath: 'packages/plugin-sdk/src/render-slots.ts',
      status: 'added',
    },
    {
      path: 'README.md',
      workspacePath: 'packages/plugin-sdk/README.md',
      status: 'modified',
    },
  ],
} satisfies GitRepository

export const gitCleanRepositoryFixture = {
  path: 'apps/docs',
  name: 'docs',
  absolutePath: '/Users/alex/Developer/cradle-app/apps/docs',
  branch: 'main',
  tracking: 'origin/main',
  ahead: 0,
  behind: 0,
  isDetached: false,
  files: [],
} satisfies GitRepository

export const gitChangesRepositoriesFixture: GitRepository[] = [
  gitChangesRepositoryFixture,
  gitPluginChangesRepositoryFixture,
  gitCleanRepositoryFixture,
]
