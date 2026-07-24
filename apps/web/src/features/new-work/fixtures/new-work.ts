import type { Workspace } from '~/features/workspace/types'

const fixtureNow = 1_784_836_800

export const newWorkWorkspaceFixtures = [
  {
    id: 'workspace-cradle',
    name: 'Cradle App',
    locator: {
      hostId: 'local',
      path: '/Users/demo/cradle-app',
      kind: 'project',
    },
    gitIdentity: {
      originUrl: 'https://github.com/wibus-wee/cradle-app.git',
      repoRoot: '/Users/demo/cradle-app',
      headSha: '0123456789abcdef',
      branch: 'main',
    },
    identifier: 'local:/Users/demo/cradle-app',
    availability: 'available',
    pinned: 1,
    createdAt: fixtureNow - 86_400,
    updatedAt: fixtureNow - 30,
  },
  {
    id: 'workspace-docs',
    name: 'Product documentation',
    locator: {
      hostId: 'local',
      path: '/Users/demo/product-documentation',
      kind: 'project',
    },
    gitIdentity: {
      originUrl: 'https://github.com/example/product-documentation.git',
      repoRoot: '/Users/demo/product-documentation',
      headSha: 'fedcba9876543210',
      branch: 'docs/navigation',
    },
    identifier: 'local:/Users/demo/product-documentation',
    availability: 'available',
    pinned: 0,
    createdAt: fixtureNow - 172_800,
    updatedAt: fixtureNow - 300,
  },
] satisfies Workspace[]
