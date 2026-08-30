import type { WorkListViewProps } from './WorkListView'

export const workListFixture: WorkListViewProps = {
  works: [],
  archivedWorks: [],
  workspaces: [{
    id: 'workspace-1',
    name: 'Cradle',
    locator: { nodeId: 'local', path: '/Users/demo/dev/cradle', kind: 'project' },
    gitIdentity: { branch: 'main' },
    identifier: 'cradle',
    multiFolder: false,
    availability: 'available',
    pinned: 1,
    createdAt: 1_750_000_000,
    updatedAt: 1_750_000_000,
  }],
  onCreate: () => {},
  onNavigate: () => {},
  onOpen: () => {},
  onOpenInfo: () => {},
  onOpenUsage: () => {},
}
