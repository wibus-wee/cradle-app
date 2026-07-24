import type { DownloadTask } from '~/features/download-center/types'

import type { ManagedResource } from '../projection'

const unavailableAction = {
  available: false,
  reasonCode: 'managed_resource_action_unavailable',
}

export const managedResourceFixtures = [
  {
    key: {
      namespace: 'codex',
      resourceType: 'runtime',
      resourceId: 'app-server',
    },
    displayName: 'Codex app server',
    description: 'Native runtime used for Codex chat sessions and tool execution.',
    kind: 'runtime',
    required: true,
    state: 'installed',
    installationSource: 'managed',
    installedVersion: '0.28.0',
    availableVersion: '0.28.0',
    installedSizeBytes: 86_400_000,
    downloadSizeBytes: 31_200_000,
    actions: {
      install: unavailableAction,
      update: unavailableAction,
      uninstall: { available: true, reasonCode: null },
    },
  },
  {
    key: {
      namespace: 'opencode',
      resourceType: 'runtime',
      resourceId: 'cli',
    },
    displayName: 'OpenCode CLI',
    description: 'Optional local runtime for OpenCode provider sessions.',
    kind: 'runtime',
    required: false,
    state: 'update-available',
    installationSource: 'managed',
    installedVersion: '1.16.0',
    availableVersion: '1.17.11',
    installedSizeBytes: 42_000_000,
    downloadSizeBytes: 18_000_000,
    actions: {
      install: unavailableAction,
      update: { available: true, reasonCode: null },
      uninstall: unavailableAction,
    },
  },
  {
    key: {
      namespace: 'chronicle',
      resourceType: 'model',
      resourceId: 'speaker-embedding',
    },
    displayName: 'Speaker embedding model',
    description: 'Identifies recurring speakers in Chronicle audio transcripts.',
    kind: 'model',
    required: false,
    state: 'installing',
    installationSource: 'managed',
    installedVersion: null,
    availableVersion: '2026.07',
    installedSizeBytes: null,
    downloadSizeBytes: 128_000_000,
    actions: {
      install: unavailableAction,
      update: unavailableAction,
      uninstall: unavailableAction,
    },
  },
  {
    key: {
      namespace: 'chronicle',
      resourceType: 'model',
      resourceId: 'pii-redaction',
    },
    displayName: 'PII redaction model',
    description: 'Optional local model for privacy-sensitive Chronicle text.',
    kind: 'model',
    required: false,
    state: 'not-installed',
    installationSource: 'external',
    installedVersion: null,
    availableVersion: '2.4.1',
    installedSizeBytes: null,
    downloadSizeBytes: 245_000_000,
    actions: {
      install: { available: true, reasonCode: null },
      update: unavailableAction,
      uninstall: unavailableAction,
    },
  },
] satisfies ManagedResource[]

const taskBase = {
  sourceId: 'release-primary',
  attempts: 1,
  maxAttempts: 3,
  error: null,
  result: null,
  createdAt: '2026-07-24T08:00:00.000Z',
  startedAt: '2026-07-24T08:00:02.000Z',
  finishedAt: null,
}

export const managedResourceTaskFixtures = [
  {
    ...taskBase,
    taskId: 'speaker-model-download',
    scope: 'server',
    owner: {
      namespace: 'chronicle',
      resourceType: 'model',
      resourceId: 'speaker-embedding',
      displayName: 'Speaker embedding model',
    },
    fileName: 'speaker-embedding-v2026.07.bin',
    status: 'downloading',
    transferredBytes: 72_000_000,
    totalBytes: 128_000_000,
    updatedAt: '2026-07-24T08:04:00.000Z',
  },
  {
    ...taskBase,
    taskId: 'codex-runtime-update',
    scope: 'desktop',
    owner: {
      namespace: 'codex',
      resourceType: 'runtime',
      resourceId: 'app-server',
      displayName: 'Codex app server',
    },
    fileName: 'codex-app-server-universal.tar.gz',
    status: 'completed',
    transferredBytes: 31_200_000,
    totalBytes: 31_200_000,
    result: {
      taskId: 'codex-runtime-update',
      bytes: 31_200_000,
      checksum: {
        algorithm: 'sha256',
        expected: 'fixture-checksum',
        actual: 'fixture-checksum',
        matched: true,
      },
    },
    updatedAt: '2026-07-24T07:30:00.000Z',
    finishedAt: '2026-07-24T07:30:00.000Z',
  },
  {
    ...taskBase,
    taskId: 'pii-model-download',
    scope: 'server',
    owner: {
      namespace: 'chronicle',
      resourceType: 'model',
      resourceId: 'pii-redaction',
      displayName: 'PII redaction model',
    },
    fileName: 'pii-redaction-v2.4.1.bin',
    status: 'failed',
    transferredBytes: 19_000_000,
    totalBytes: 245_000_000,
    error: {
      code: 'download_source_unavailable',
      message: 'The primary source did not respond.',
      retryable: true,
    },
    updatedAt: '2026-07-24T06:15:00.000Z',
    finishedAt: '2026-07-24T06:15:00.000Z',
  },
] satisfies DownloadTask[]
