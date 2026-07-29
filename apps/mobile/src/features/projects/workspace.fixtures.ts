import type { WorkspaceViewProps } from './WorkspaceView'

export const workspaceFixture: WorkspaceViewProps = {
  workspace: {
    id: 'workspace-1',
    name: 'Cradle',
    locator: { hostId: 'local', path: '/Users/demo/dev/cradle', kind: 'project' },
    gitIdentity: { branch: 'main' },
    identifier: 'cradle',
    availability: 'available',
    pinned: 1,
    createdAt: 1_750_000_000,
    updatedAt: 1_750_000_000,
  },
  workspaces: [
    {
      id: 'workspace-1',
      name: 'Cradle',
      locator: { hostId: 'local', path: '/Users/demo/dev/cradle', kind: 'project' },
      gitIdentity: { branch: 'main' },
      identifier: 'cradle',
      availability: 'available',
      pinned: 1,
      createdAt: 1_750_000_000,
      updatedAt: 1_750_000_000,
    },
  ],
  sessions: [],
  works: [],
  files: [
    { type: 'directory', name: 'apps', path: 'apps' },
    { type: 'file', name: 'README.md', path: 'README.md' },
  ],
  onCreate: () => {},
  onOpenSession: () => {},
  onOpenWork: () => {},
}
