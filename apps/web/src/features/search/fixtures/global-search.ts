import {
  CommandLine,
  Message1Line,
  Settings2Line,
  TerminalLine,
} from '@mingcute/react'

import type { PaletteData } from '../palette/types'

const commandFixtures: PaletteData['commands'] = [
  {
    id: 'new-chat',
    label: 'New conversation',
    keywords: 'new chat session create',
    icon: Message1Line,
    source: 'app',
    handler: () => {},
  },
  {
    id: 'open-settings',
    label: 'Open settings',
    keywords: 'settings preferences',
    icon: Settings2Line,
    shortcut: '⌘,',
    source: 'app',
    handler: () => {},
  },
  {
    id: 'toggle-sidebar',
    label: 'Toggle sidebar',
    keywords: 'sidebar toggle',
    icon: TerminalLine,
    shortcut: '⌘B',
    source: 'app',
    handler: () => {},
  },
  {
    id: 'plugin.release-check',
    label: 'Run release check',
    description: 'Release Tools · Cradle plugin',
    keywords: 'plugin release verify',
    icon: CommandLine,
    source: 'plugin',
    handler: () => {},
  },
]

const recentConversationFixtures: PaletteData['recentConversations'] = [
  {
    id: 'session-component-architecture',
    title: 'Refactor component architecture',
  },
  {
    id: 'session-storybook',
    title: 'Expand Storybook surfaces',
  },
  {
    id: 'session-release',
    title: 'Review release checks',
  },
]

const fileFixtures: PaletteData['files'] = [
  {
    type: 'file',
    name: 'global-search-dialog-view.tsx',
    path: 'apps/web/src/features/search/global-search-dialog-view.tsx',
  },
  {
    type: 'file',
    name: 'package.json',
    path: 'apps/web/package.json',
  },
  {
    type: 'file',
    name: 'AGENTS.md',
    path: 'AGENTS.md',
  },
]

const workspaceFixtures: PaletteData['workspaces'] = [
  {
    id: 'workspace-cradle',
    name: 'Cradle App',
    locator: {
      hostId: 'local',
      path: '/Users/demo/cradle-app',
      kind: 'project',
    },
    identifier: 'local:/Users/demo/cradle-app',
  },
  {
    id: 'workspace-docs',
    name: 'Product documentation',
    locator: {
      hostId: 'local',
      path: '/Users/demo/product-documentation',
      kind: 'project',
    },
    identifier: 'local:/Users/demo/product-documentation',
  },
]

const threadFixtures: PaletteData['threads'] = [
  {
    sessionId: 'session-component-architecture',
    workspaceId: 'workspace-cradle',
    workspaceName: 'Cradle App',
    sessionTitle: 'Refactor component architecture',
    origin: 'manual',
    titleRanges: [{ start: 9, end: 18 }],
    snippets: [
      {
        text: 'Move queries and stores into Containers, then render fixture-driven Views.',
        ranges: [{ start: 57, end: 62 }],
        messageRole: 'assistant',
        messageId: 'message-architecture',
        createdAt: 1_784_836_700,
      },
    ],
    matchCount: 2,
    score: 0.98,
    updatedAt: 1_784_836_700,
  },
  {
    sessionId: 'session-storybook',
    workspaceId: 'workspace-cradle',
    workspaceName: 'Cradle App',
    sessionTitle: 'Expand Storybook surfaces',
    origin: 'manual',
    titleRanges: [{ start: 7, end: 16 }],
    snippets: [],
    matchCount: 1,
    score: 0.87,
    updatedAt: 1_784_836_600,
  },
]

const issueFixtures: PaletteData['issues'] = [
  {
    id: 'issue-search-boundary',
    title: 'Extract the global search rendering boundary',
    workspaceId: 'workspace-cradle',
    priority: 'high',
    labels: ['frontend', 'architecture'],
  },
  {
    id: 'issue-mobile-overflow',
    title: 'Verify command palette on mobile viewports',
    workspaceId: 'workspace-cradle',
    priority: 'medium',
    labels: ['frontend'],
  },
]

const baseData = {
  commands: commandFixtures,
  filteredCommands: [],
  suggestedCommands: commandFixtures.slice(0, 3),
  recentConversations: recentConversationFixtures,
  files: fileFixtures,
  workspaces: workspaceFixtures,
  threads: [],
  issues: [],
  fileWorkspaceId: 'workspace-cradle',
  fileAvailability: 'available',
  fileUnavailable: false,
  boardId: 'board-cradle',
  isPending: false,
  hasQuery: false,
} satisfies PaletteData

export const globalSearchDataFixtures = {
  landing: baseData,
  allResults: {
    ...baseData,
    suggestedCommands: [],
    recentConversations: [],
    threads: threadFixtures,
    issues: issueFixtures,
    hasQuery: true,
  },
  commands: {
    ...baseData,
    filteredCommands: commandFixtures,
    suggestedCommands: [],
    recentConversations: [],
    files: [],
    workspaces: [],
    hasQuery: true,
  },
  pending: {
    ...baseData,
    filteredCommands: [],
    suggestedCommands: [],
    recentConversations: [],
    files: [],
    workspaces: [],
    isPending: true,
    hasQuery: true,
  },
  empty: {
    ...baseData,
    filteredCommands: [],
    suggestedCommands: [],
    recentConversations: [],
    files: [],
    workspaces: [],
    hasQuery: true,
  },
} satisfies Record<string, PaletteData>
