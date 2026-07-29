import type { WorkListViewProps } from './WorkListView'

export const workListFixture: WorkListViewProps = {
  works: [],
  workspaces: [{
    id: 'workspace-1',
    name: 'Cradle',
    locator: { hostId: 'local', path: '/Users/demo/dev/cradle', kind: 'project' },
    gitIdentity: { branch: 'main' },
    identifier: 'cradle',
    availability: 'available',
    pinned: 1,
    createdAt: 1_750_000_000,
    updatedAt: 1_750_000_000,
  }],
  onCreate: () => {},
  onNavigate: () => {},
  onOpen: () => {},
  onOpenUsage: () => {},
}
