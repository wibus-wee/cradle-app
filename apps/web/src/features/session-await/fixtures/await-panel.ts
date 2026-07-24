import type {
  SessionAwait,
  SessionAwaitLiveStatusById,
} from '../types'
import type {
  LiveCIStatus,
  LiveReviewStatus,
} from '../use-live-await-status'

const baseAwait = {
  chatSessionId: 'session-release',
  workspaceId: 'workspace-cradle',
  filterJson: '{}',
  reason: null,
  resumeText: null,
  resumePayloadJson: null,
  failureKind: null,
  bypassedChecksJson: null,
  createdAt: 1_784_833_000,
  triggeredAt: null,
  expiresAt: null,
  fireAt: null,
  lastCheckedAt: 1_784_833_540,
  lastErrorText: null,
  consecutiveErrorCount: 0,
} satisfies Omit<SessionAwait, 'id' | 'source' | 'status'>

export const pendingCIAwaitFixture = {
  ...baseAwait,
  id: 'await-ci-release',
  source: 'github-ci',
  status: 'pending',
  reason: 'Waiting for required release checks.',
} satisfies SessionAwait

export const pendingReviewAwaitFixture = {
  ...baseAwait,
  id: 'await-review-runtime',
  source: 'github-review',
  status: 'pending',
  reason: 'Waiting for an approval.',
} satisfies SessionAwait

export const failedDeliveryAwaitFixture = {
  ...baseAwait,
  id: 'await-delivery-failure',
  source: 'github-ci',
  status: 'failed',
  failureKind: 'delivery',
  lastErrorText: 'The matching CI signal arrived, but session resume delivery failed.',
  consecutiveErrorCount: 1,
} satisfies SessionAwait

export const completedAwaitFixture = {
  ...baseAwait,
  id: 'await-completed',
  source: 'timer',
  status: 'triggered',
  resumePayloadJson: JSON.stringify({
    kind: 'timer',
  }),
  triggeredAt: 1_784_833_560,
} satisfies SessionAwait

export const liveCIAwaitFixture = {
  supported: true,
  kind: 'github-ci',
  owner: 'wibus-wee',
  repo: 'cradle-app',
  prNumber: 71,
  prTitle: 'Expose fixture-driven Storybook surfaces',
  ref: 'refs/pull/71/head',
  checkRuns: [
    {
      id: 501,
      name: 'quality / lint',
      status: 'completed',
      conclusion: 'success',
      required: true,
      htmlUrl: 'https://github.com/wibus-wee/cradle-app/runs/501',
      detailsUrl: null,
      workflowRunId: 401,
      workflowJobId: 301,
      steps: [
        {
          name: 'Checkout',
          status: 'completed',
          conclusion: 'success',
          number: 1,
          startedAt: '2026-07-24T08:00:00Z',
          completedAt: '2026-07-24T08:00:05Z',
        },
        {
          name: 'Run ESLint',
          status: 'completed',
          conclusion: 'success',
          number: 2,
          startedAt: '2026-07-24T08:00:05Z',
          completedAt: '2026-07-24T08:01:15Z',
        },
      ],
    },
    {
      id: 502,
      name: 'desktop / macOS arm64',
      status: 'in_progress',
      conclusion: null,
      required: false,
      htmlUrl: 'https://github.com/wibus-wee/cradle-app/runs/502',
      detailsUrl: null,
      workflowRunId: 402,
      workflowJobId: 302,
      steps: [
        {
          name: 'Build desktop package',
          status: 'in_progress',
          conclusion: null,
          number: 1,
          startedAt: '2026-07-24T08:01:00Z',
          completedAt: null,
        },
      ],
    },
  ],
  workflowRuns: [
    {
      id: 402,
      name: 'Desktop',
      displayTitle: 'Desktop build matrix',
      runNumber: 92,
      runAttempt: 1,
      status: 'in_progress',
      conclusion: null,
      headSha: '0287c8aef52f',
      htmlUrl: 'https://github.com/wibus-wee/cradle-app/actions/runs/402',
      createdAt: '2026-07-24T08:00:00Z',
      updatedAt: '2026-07-24T08:02:00Z',
      jobs: [
        {
          id: 302,
          name: 'macOS arm64',
          status: 'in_progress',
          conclusion: null,
          htmlUrl: 'https://github.com/wibus-wee/cradle-app/actions/jobs/302',
          checkRunId: 502,
          startedAt: '2026-07-24T08:01:00Z',
          completedAt: null,
          runnerName: 'macos-15',
          labels: ['macos-15'],
          steps: [],
        },
        {
          id: 303,
          name: 'Windows x64',
          status: 'queued',
          conclusion: null,
          htmlUrl: 'https://github.com/wibus-wee/cradle-app/actions/jobs/303',
          checkRunId: null,
          startedAt: null,
          completedAt: null,
          runnerName: null,
          labels: ['windows-2025'],
          steps: [],
        },
      ],
    },
  ],
  statuses: [
    {
      context: 'deploy/storybook-preview',
      state: 'success',
      description: 'Preview deployed',
      targetUrl: 'https://example.com/storybook',
    },
  ],
  totalCount: 3,
  pendingCount: 1,
  failureCount: 0,
  allCompleted: false,
  allPassed: false,
  noCIConfigured: false,
  hasToken: true,
} satisfies LiveCIStatus

export const liveReviewAwaitFixture = {
  supported: true,
  kind: 'github-review',
  owner: 'wibus-wee',
  repo: 'cradle-app',
  prNumber: 71,
  prTitle: 'Expose fixture-driven Storybook surfaces',
  mode: 'approved',
  headSha: '0287c8aef52f',
  matched: false,
  approvedCount: 1,
  changesRequestedCount: 0,
  reviews: [
    {
      id: 901,
      reviewer: 'reviewer-one',
      state: 'APPROVED',
      commitId: '0287c8aef52f',
      submittedAt: '2026-07-24T08:03:00Z',
    },
    {
      id: 902,
      reviewer: 'reviewer-two',
      state: 'COMMENTED',
      commitId: '0287c8aef52f',
      submittedAt: '2026-07-24T08:04:00Z',
    },
  ],
  hasToken: true,
} satisfies LiveReviewStatus

export const activeAwaitStatusesFixture: SessionAwaitLiveStatusById = new Map([
  [pendingCIAwaitFixture.id, liveCIAwaitFixture],
])

export const reviewAwaitStatusesFixture: SessionAwaitLiveStatusById = new Map([
  [pendingReviewAwaitFixture.id, liveReviewAwaitFixture],
])
