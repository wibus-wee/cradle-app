import type { ProjectsViewProps } from './ProjectsView'

export const projectsFixture: ProjectsViewProps = {
  projects: [
    {
      workspace: {
        id: 'workspace-1',
        name: 'Cradle',
        locator: { hostId: 'local', path: '/Users/demo/dev/cradle', kind: 'project' },
        gitIdentity: { branch: 'main', originUrl: 'git@github.com:example/cradle.git' },
        identifier: 'cradle',
        availability: 'available',
        pinned: 1,
        createdAt: 1_750_000_000,
        updatedAt: 1_750_000_000,
      },
      sessions: [],
    },
  ],
  onCreate: () => {},
  onNavigate: () => {},
  onOpenUsage: () => {},
  onOpenProject: () => {},
}
