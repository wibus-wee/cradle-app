import type { Workspace } from '~/features/workspace/types'

import type { CreateAutomationDraft } from '../automation-draft'
import type {
  AutomationArtifact,
  AutomationDefinition,
  AutomationRun,
} from '../types'

export const automationFixtureNow = 1_784_833_600_000

export const releaseAutomationFixture = {
  id: 'automation-release-readiness',
  workspaceId: 'workspace-cradle',
  title: 'Release readiness audit',
  description: 'Audit desktop release inputs and summarize blocking findings.',
  enabled: true,
  trigger: {
    type: 'rrule',
    rrule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TH;BYHOUR=9;BYMINUTE=30;BYSECOND=0',
    timezone: 'Asia/Singapore',
    misfirePolicy: 'run_latest',
  },
  recipe: {
    kind: 'agent_task',
    prompt: [
      'Review the current release branch.',
      'Check CI, changelog, signing artifacts, and unresolved blockers.',
      'Write a concise release-readiness report.',
    ].join('\n'),
    inputs: [],
    artifactRequests: [{ kind: 'markdown', name: 'release-readiness.md' }],
    providerTargetId: 'provider-codex',
    runtimeKind: 'codex-app-server',
    modelId: 'gpt-5.4',
    thinkingEffort: 'high',
    sessionPolicy: 'new',
    isolationPolicy: 'worktree_per_run',
    completionPolicy: {
      stopWhen: 'agent_complete',
      noFindingsBehavior: 'triage',
    },
  },
  createdBy: 'user',
  createdAt: automationFixtureNow / 1000 - 30 * 86_400,
  updatedAt: automationFixtureNow / 1000 - 2 * 3_600,
  nextRunAt: automationFixtureNow / 1000 + 22 * 3_600,
} satisfies AutomationDefinition

export const automationRunFixtures = [
  {
    id: 'run-release-104',
    automationDefinitionId: releaseAutomationFixture.id,
    workspaceId: 'workspace-cradle',
    status: 'running',
    reason: 'scheduled',
    scheduledFor: automationFixtureNow / 1000 - 6 * 60,
    startedAt: automationFixtureNow / 1000 - 5 * 60,
    createdAt: automationFixtureNow / 1000 - 6 * 60,
    chatSessionId: 'session-release-104',
    backendRunId: 'runtime-release-104',
    resultKind: null,
    resultSummary: 'Reviewing desktop signing and CI artifacts.',
    triageStatus: 'unread',
  },
  {
    id: 'run-release-103',
    automationDefinitionId: releaseAutomationFixture.id,
    workspaceId: 'workspace-cradle',
    status: 'complete',
    reason: 'scheduled',
    scheduledFor: automationFixtureNow / 1000 - 4 * 86_400,
    startedAt: automationFixtureNow / 1000 - 4 * 86_400,
    finishedAt: automationFixtureNow / 1000 - 4 * 86_400 + 420,
    createdAt: automationFixtureNow / 1000 - 4 * 86_400,
    chatSessionId: 'session-release-103',
    backendRunId: 'runtime-release-103',
    resultKind: 'findings',
    resultSummary: 'Two blockers found: notarization credentials and missing changelog entry.',
    triageStatus: 'resolved',
  },
  {
    id: 'run-release-102',
    automationDefinitionId: releaseAutomationFixture.id,
    workspaceId: 'workspace-cradle',
    status: 'failed',
    reason: 'scheduled',
    errorText: 'Runtime target was unavailable.',
    scheduledFor: automationFixtureNow / 1000 - 11 * 86_400,
    startedAt: automationFixtureNow / 1000 - 11 * 86_400,
    finishedAt: automationFixtureNow / 1000 - 11 * 86_400 + 45,
    createdAt: automationFixtureNow / 1000 - 11 * 86_400,
    resultKind: 'error',
    resultSummary: null,
    triageStatus: 'archived',
  },
] satisfies AutomationRun[]

export const automationArtifactFixtures = [
  {
    id: 'artifact-release-103',
    automationId: releaseAutomationFixture.id,
    runId: 'run-release-103',
    title: 'release-readiness.md',
    name: 'release-readiness.md',
    kind: 'markdown',
    mediaType: 'text/markdown',
    content: [
      '# Release readiness',
      '',
      '## Blocking',
      '',
      '- Notarization credentials are unavailable in the release workflow.',
      '- The current version is missing a changelog entry.',
      '',
      '## Passing',
      '',
      '- Web typecheck',
      '- Storybook build',
      '- Desktop unit tests',
    ].join('\n'),
    metadata: { severity: 'blocking', findingCount: 2 },
    createdAt: automationFixtureNow / 1000 - 4 * 86_400 + 420,
  },
  {
    id: 'artifact-release-103-metadata',
    automationId: releaseAutomationFixture.id,
    runId: 'run-release-103',
    title: 'run-metadata.json',
    name: 'run-metadata.json',
    kind: 'json',
    mediaType: 'application/json',
    content: JSON.stringify({ checks: 18, passed: 16, blocked: 2 }, null, 2),
    metadata: null,
    createdAt: automationFixtureNow / 1000 - 4 * 86_400 + 420,
  },
] satisfies AutomationArtifact[]

export const automationWorkspaceFixtures = [
  {
    id: 'workspace-cradle',
    name: 'cradle-app',
    locator: {
      hostId: 'local',
      path: '/workspace/cradle-app',
      kind: 'project',
    },
    gitIdentity: {
      originUrl: 'https://github.com/wibus-wee/cradle-app.git',
      repoRoot: '/workspace/cradle-app',
      headSha: '0123456789abcdef',
      branch: 'main',
    },
    identifier: 'workspace-cradle',
    availability: 'available',
    pinned: 1,
    createdAt: automationFixtureNow / 1000 - 120 * 86_400,
    updatedAt: automationFixtureNow / 1000 - 15 * 60,
  },
  {
    id: 'workspace-docs',
    name: 'product-docs',
    locator: {
      hostId: 'local',
      path: '/workspace/product-docs',
      kind: 'project',
    },
    gitIdentity: {
      originUrl: 'https://github.com/example/product-docs.git',
      repoRoot: '/workspace/product-docs',
      headSha: 'fedcba9876543210',
      branch: 'main',
    },
    identifier: 'workspace-docs',
    availability: 'available',
    pinned: 0,
    createdAt: automationFixtureNow / 1000 - 60 * 86_400,
    updatedAt: automationFixtureNow / 1000 - 2 * 3_600,
  },
] satisfies Workspace[]

export const automationDefinitionFixtures = [
  releaseAutomationFixture,
  {
    ...releaseAutomationFixture,
    id: 'automation-docs-drift',
    workspaceId: 'workspace-docs',
    title: 'Documentation drift scan',
    description: 'Find stale product documentation.',
    enabled: true,
    trigger: {
      ...releaseAutomationFixture.trigger,
      rrule:
        'FREQ=DAILY;INTERVAL=1;BYHOUR=7;BYMINUTE=0;BYSECOND=0',
      timezone: 'UTC',
    },
    latestRun: automationRunFixtures[1],
  },
  {
    ...releaseAutomationFixture,
    id: 'automation-dependency-audit',
    title: 'Dependency audit',
    enabled: false,
    latestRun: automationRunFixtures[2],
  },
] satisfies AutomationDefinition[]

export const automationDraftFixture = {
  title: 'Release readiness audit',
  description: 'Review release inputs before the weekly cut.',
  workspaceId: 'workspace-cradle',
  enabled: true,
  schedule: {
    frequency: 'weekly',
    interval: 1,
    weekdays: ['MO', 'TH'],
    monthDay: 1,
    time: '09:30',
  },
  timezone: 'Asia/Singapore',
  misfirePolicy: 'run_latest',
  providerTargetId: 'provider-codex',
  runtimeKind: 'codex-app-server',
  modelId: 'gpt-5.4',
  thinkingEffort: 'high',
  sessionPolicy: 'new',
  isolationPolicy: 'worktree_per_run',
  noFindingsBehavior: 'triage',
  prompt: [
    'Review the current release branch.',
    'Check CI, changelog, signing artifacts, and unresolved blockers.',
    'Write a concise release-readiness report.',
  ].join('\n'),
  artifactName: 'release-readiness.md',
} satisfies CreateAutomationDraft
