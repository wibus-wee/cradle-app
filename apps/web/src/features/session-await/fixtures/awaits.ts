import type { DesktopAwaitItem } from '~/features/desktop-tray/types'

export const awaitsFixtureNow = 1_784_833_600_000

export const pendingAwaitFixtures = [
  {
    id: 'await-ci-release',
    sessionId: 'session-release',
    title: 'Prepare desktop release',
    workspaceId: 'workspace-cradle',
    workspaceName: 'cradle-app',
    source: 'github-ci',
    reason: 'Waiting for desktop builds, lint, and the release smoke suite.',
    createdAt: awaitsFixtureNow / 1000 - 7 * 60,
  },
  {
    id: 'await-review-runtime',
    sessionId: 'session-runtime',
    title: 'Review runtime protocol update',
    workspaceId: 'workspace-cradle',
    workspaceName: 'cradle-app',
    source: 'github-review',
    reason: 'Waiting for an approval on the generated protocol compatibility changes.',
    createdAt: awaitsFixtureNow / 1000 - 2 * 3_600,
  },
  {
    id: 'await-timer-docs',
    sessionId: 'session-docs',
    title: 'Resume documentation audit',
    workspaceId: 'workspace-docs',
    workspaceName: 'product-docs',
    source: 'timer',
    reason: null,
    createdAt: awaitsFixtureNow / 1000 - 26 * 3_600,
  },
] satisfies DesktopAwaitItem[]
