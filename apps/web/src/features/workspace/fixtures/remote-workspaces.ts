import type { GetRemoteHostsResponse } from '~/api-gen/types.gen'
import type { WorkspaceFileEntry } from '~/features/workspace/api/files'
import type { Workspace } from '~/features/workspace/types'

type RemoteHost = GetRemoteHostsResponse[number]

export const remoteWorkspaceFixtureNow = 1_784_836_800

export const remoteHostFixtures = {
  connected: {
    id: 'remote-host-staging',
    displayName: 'Staging Mac Studio',
    enabled: true,
    lastSeenAt: remoteWorkspaceFixtureNow - 12,
    connectionConfigJson: JSON.stringify({
      transport: 'ssh',
      hostName: 'staging.example.com',
    }),
    capabilitiesJson: JSON.stringify({
      filesystemBrowse: true,
      workspaceImport: true,
    }),
    createdAt: remoteWorkspaceFixtureNow - 604_800,
    updatedAt: remoteWorkspaceFixtureNow - 12,
    connectionState: 'connected',
    lastError: null,
  },
  connectedBackup: {
    id: 'remote-host-build',
    displayName: 'Build workstation with a long hostname',
    enabled: true,
    lastSeenAt: remoteWorkspaceFixtureNow - 45,
    connectionConfigJson: JSON.stringify({
      transport: 'direct-url',
      baseUrl: 'https://build.example.com',
    }),
    capabilitiesJson: JSON.stringify({
      filesystemBrowse: true,
      workspaceImport: true,
    }),
    createdAt: remoteWorkspaceFixtureNow - 1_209_600,
    updatedAt: remoteWorkspaceFixtureNow - 45,
    connectionState: 'connected',
    lastError: null,
  },
  offline: {
    id: 'remote-host-offline',
    displayName: 'Offline laptop',
    enabled: true,
    lastSeenAt: remoteWorkspaceFixtureNow - 86_400,
    connectionConfigJson: JSON.stringify({
      transport: 'relay',
    }),
    capabilitiesJson: '{}',
    createdAt: remoteWorkspaceFixtureNow - 2_419_200,
    updatedAt: remoteWorkspaceFixtureNow - 86_400,
    connectionState: 'offline',
    lastError: 'Relay connection timed out.',
  },
} satisfies Record<string, RemoteHost>

export const remoteWorkspaceFixtures = {
  cradle: {
    id: 'remote-workspace-cradle',
    name: 'cradle-app',
    locator: {
      hostId: 'local',
      path: '/Users/runner/projects/cradle-app',
      kind: 'project',
    },
    gitIdentity: {
      originUrl: 'https://github.com/wibus-wee/cradle-app.git',
      repoRoot: '/Users/runner/projects/cradle-app',
      headSha: '7f9ce947adfcf35fb02d3ef03ae4cf940ffcbd40',
      branch: 'main',
    },
    identifier: 'local:/Users/runner/projects/cradle-app',
    availability: 'available',
    pinned: 1,
    createdAt: remoteWorkspaceFixtureNow - 604_800,
    updatedAt: remoteWorkspaceFixtureNow - 30,
  },
  docs: {
    id: 'remote-workspace-docs',
    name: 'product-documentation',
    locator: {
      hostId: 'local',
      path: '/Users/runner/projects/product-documentation',
      kind: 'project',
    },
    gitIdentity: {
      originUrl: 'https://github.com/example/product-documentation.git',
      repoRoot: '/Users/runner/projects/product-documentation',
      headSha: '19a8f872b7d111cfbf3baa879e00ec2781082fc5',
      branch: 'docs/navigation-rewrite',
    },
    identifier: 'local:/Users/runner/projects/product-documentation',
    availability: 'available',
    pinned: 0,
    createdAt: remoteWorkspaceFixtureNow - 1_209_600,
    updatedAt: remoteWorkspaceFixtureNow - 240,
  },
  scripts: {
    id: 'remote-workspace-scripts',
    name: 'release-scripts',
    locator: {
      hostId: 'local',
      path: '/Users/runner/automation/release-scripts',
      kind: 'project',
    },
    gitIdentity: {
      originUrl: null,
      repoRoot: '/Users/runner/automation/release-scripts',
      headSha: null,
      branch: null,
    },
    identifier: 'local:/Users/runner/automation/release-scripts',
    availability: 'available',
    pinned: 0,
    createdAt: remoteWorkspaceFixtureNow - 2_419_200,
    updatedAt: remoteWorkspaceFixtureNow - 3_600,
  },
} satisfies Record<string, Workspace>

export const remoteWorkspaceFileFixtures = [
  {
    type: 'directory',
    name: 'apps',
    path: 'apps',
  },
  {
    type: 'directory',
    name: 'packages',
    path: 'packages',
  },
  {
    type: 'file',
    name: 'AGENTS.md',
    path: 'AGENTS.md',
  },
  {
    type: 'file',
    name: 'package.json',
    path: 'package.json',
  },
  {
    type: 'file',
    name: 'pnpm-lock.yaml',
    path: 'pnpm-lock.yaml',
  },
] satisfies WorkspaceFileEntry[]
