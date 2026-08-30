import type { Meta, StoryObj } from '@storybook/react-vite'

import type { StorageManagerCopy } from './storage-manager-view'
import { StorageManagerView } from './storage-manager-view'

const MB = 1024 * 1024
const copy: StorageManagerCopy = {
  title: 'Storage',
  description: 'Review disk usage and remove data you no longer need.',
  totalUsed: 'Cradle data',
  measuredNow: 'Measured now',
  refresh: 'Refresh storage',
  categories: { database: 'Database', runtime: 'Runtime data', attachments: 'Attachments', artifacts: 'Artifacts', terminal: 'Terminal history', diagnostics: 'Logs & diagnostics', other: 'Other' },
  categoryFiles: count => `${count} files`,
  sessionsTitle: 'Sessions',
  sessionsCount: count => `${count} sessions`,
  searchPlaceholder: 'Search sessions',
  largestFirst: 'Largest',
  recentFirst: 'Recent',
  selectAll: 'Select all',
  clearTranscript: 'Clear transcript',
  deleteSession: 'Delete session',
  selected: count => `${count} selected`,
  clearSelected: 'Clear transcripts',
  deleteSelected: 'Delete',
  empty: 'No sessions are using local storage.',
  noMatches: 'No sessions match this search.',
  error: 'Storage usage could not be measured.',
  active: 'Active',
  archived: 'Archived',
  messages: count => `${count} messages`,
  localData: 'Local',
  runtimeData: 'Runtime',
  attachments: 'Files',
  artifacts: 'Artifacts',
  terminal: 'Terminal',
  confirmClearTitle: count => count === 1 ? 'Clear this transcript?' : `Clear ${count} transcripts?`,
  confirmClearDescription: 'Messages, run history, attachments, and supported provider-native sessions are removed. Session titles and workspace links remain.',
  confirmDeleteTitle: count => count === 1 ? 'Delete this session?' : `Delete ${count} sessions?`,
  confirmDeleteDescription: 'Sessions and all Cradle-owned data are permanently removed. Provider data outside Cradle is preserved.',
  cancel: 'Cancel',
  confirmClear: 'Clear transcripts',
  confirmDelete: 'Delete sessions',
}

const overview = {
  measuredAt: 1_788_000_000,
  dataDirectory: '/Users/example/Library/Application Support/Cradle',
  totalBytes: 824 * MB,
  categories: [
    { id: 'database' as const, bytes: 286 * MB, fileCount: 3 },
    { id: 'runtime' as const, bytes: 238 * MB, fileCount: 941 },
    { id: 'attachments' as const, bytes: 154 * MB, fileCount: 87 },
    { id: 'artifacts' as const, bytes: 58 * MB, fileCount: 42 },
    { id: 'terminal' as const, bytes: 12 * MB, fileCount: 29 },
    { id: 'diagnostics' as const, bytes: 34 * MB, fileCount: 18 },
    { id: 'other' as const, bytes: 42 * MB, fileCount: 121 },
  ],
  sessions: [
    { id: '1', title: 'Plan the storage manager architecture', workspaceName: 'cradle-app', runtimeKind: 'codex', updatedAt: 1_788_000_000, archivedAt: null, pinned: true, active: false, messageCount: 186, localBytes: 74 * MB, runtimeBytes: 0, attachmentBytes: 42 * MB, artifactBytes: 18 * MB, terminalBytes: 3 * MB, reclaimableBytes: 137 * MB },
    { id: '2', title: 'Investigate Claude transcript reconciliation', workspaceName: 'cradle-app', runtimeKind: 'claude-agent', updatedAt: 1_787_900_000, archivedAt: 1_787_950_000, pinned: false, active: false, messageCount: 92, localBytes: 48 * MB, runtimeBytes: 0, attachmentBytes: 9 * MB, artifactBytes: 0, terminalBytes: 2 * MB, reclaimableBytes: 59 * MB },
    { id: '3', title: 'Fix provider reconnect state', workspaceName: 'runtime-lab', runtimeKind: 'kimi', updatedAt: 1_787_800_000, archivedAt: null, pinned: false, active: true, messageCount: 41, localBytes: 21 * MB, runtimeBytes: 28 * MB, attachmentBytes: 4 * MB, artifactBytes: 6 * MB, terminalBytes: 0, reclaimableBytes: 59 * MB },
    { id: '4', title: 'Review plugin marketplace changes', workspaceName: 'cradle-app', runtimeKind: 'opencode', updatedAt: 1_787_600_000, archivedAt: null, pinned: false, active: false, messageCount: 38, localBytes: 12 * MB, runtimeBytes: 0, attachmentBytes: 0, artifactBytes: 2 * MB, terminalBytes: 1 * MB, reclaimableBytes: 15 * MB },
  ],
}

const meta = {
  title: 'Settings/Storage Manager',
  component: StorageManagerView,
  parameters: { layout: 'fullscreen' },
  args: {
    overview,
    copy,
    loading: false,
    error: false,
    busy: false,
    onRefresh: () => {},
    onAction: () => {},
  },
  decorators: [Story => <div className="h-screen bg-background"><Story /></div>],
} satisfies Meta<typeof StorageManagerView>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Loading: Story = { args: { loading: true } }
