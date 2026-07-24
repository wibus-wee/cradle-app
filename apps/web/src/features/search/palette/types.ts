import type { ComponentType } from 'react'

import type { ThreadSearchHit } from '~/features/search/types'

/**
 * Command palette data types. The palette keeps using `cmdk` for keyboard
 * navigation, accessibility and list semantics; these types describe the data
 * flowing through the restyled surface.
 */

export type PaletteModeId
  = | 'all'
    | 'commands'
    | 'files'
    | 'threads'
    | 'issues'
    | 'workspaces'

export interface CommandAction {
  id: string
  label: string
  description?: string
  keywords: string
  icon: ComponentType<{ className?: string }>
  shortcut?: string
  source: 'app' | 'plugin'
  handler: () => void | Promise<void>
}

export interface GlobalSearchFile {
  type: 'file' | 'directory'
  name: string
  path: string
}

export interface WorkspaceSearchHit {
  id: string
  name: string
  locator: {
    hostId: string
    path: string
    kind?: 'project' | 'managed-worktree'
    sourceWorkspaceId?: string | null
  }
  identifier: string
}

export interface IssueSearchHit {
  id: string
  title: string
  workspaceId: string
  priority: string
  labels: string[]
}

export interface RecentConversation {
  id: string
  title: string | null
}

export type FileSearchAvailability = 'available' | 'unsupported-tab' | 'missing-workspace'

export interface PaletteData {
  commands: CommandAction[]
  filteredCommands: CommandAction[]
  suggestedCommands: CommandAction[]
  recentConversations: RecentConversation[]
  files: GlobalSearchFile[]
  workspaces: WorkspaceSearchHit[]
  threads: ThreadSearchHit[]
  issues: IssueSearchHit[]
  fileWorkspaceId: string | null
  fileAvailability: FileSearchAvailability
  fileUnavailable: boolean
  boardId: string | null
  isPending: boolean
  hasQuery: boolean
}
