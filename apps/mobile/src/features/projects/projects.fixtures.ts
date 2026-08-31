import type { ProjectsViewProps } from './ProjectsView'

export const projectsFixture: ProjectsViewProps = {
  projects: [
    {
      workspace: {
        id: 'workspace-1',
        name: 'Cradle',
        locator: { nodeId: 'local', path: '/Users/demo/dev/cradle', kind: 'project' },
        gitIdentity: { branch: 'main', originUrl: 'git@github.com:example/cradle.git' },
        identifier: 'cradle',
        multiFolder: false,
        availability: 'available',
        pinned: 1,
        createdAt: 1_750_000_000,
        updatedAt: 1_750_000_000,
      },
      sessions: [],
    },
  ],
  onCreate: () => {},
  onOpenUsage: () => {},
  onOpenProject: () => {},
}
