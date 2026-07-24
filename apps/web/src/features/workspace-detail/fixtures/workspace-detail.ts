import type { Workspace } from '~/features/workspace/types'

import { parseWorkspaceDetailHeadings } from '../workspace-detail-toc'

export const localWorkspaceDetailFixture = {
  id: 'workspace-cradle',
  name: 'Cradle App',
  locator: {
    hostId: 'local',
    path: '/Users/demo/Projects/cradle-app',
    kind: 'project',
  },
  gitIdentity: {
    originUrl: 'https://github.com/example/cradle-app.git',
    repoRoot: '/Users/demo/Projects/cradle-app',
    headSha: '48e0762eaf3b7b98',
    branch: 'feature/component-architecture',
  },
  identifier: 'local:/Users/demo/Projects/cradle-app',
  availability: 'available',
  pinned: 1,
  createdAt: 1_784_800_000,
  updatedAt: 1_784_865_000,
} satisfies Workspace

export const remoteWorkspaceDetailFixture = {
  ...localWorkspaceDetailFixture,
  id: 'workspace-remote-docs',
  name: 'Product Documentation',
  locator: {
    hostId: 'studio-mac',
    path: '/Volumes/Projects/product-docs',
    kind: 'project',
  },
  identifier: 'studio-mac:/Volumes/Projects/product-docs',
  availability: 'remote',
} satisfies Workspace

export const workspaceAgentsFixture = `# Working Agreement

This workspace keeps product code, runtime contracts, and interface fixtures in one repository.

## Component architecture

User-visible surfaces expose a props-only View. Queries, stores, navigation, and runtime actions stay in Containers.

### Rendering seams

- Use owner-typed data.
- Keep one semantic component per production file.
- Render Views directly from Storybook fixtures.

## Verification

Run typecheck, focused lint, Web tests, and the Storybook production build before delivery.

### Browser review

Capture desktop and mobile states and verify the document width matches the viewport.
`

export const workspaceAgentsHeadingsFixture = parseWorkspaceDetailHeadings(
  workspaceAgentsFixture,
  'AGENTS.md',
)
