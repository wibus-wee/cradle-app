/**
 * System Agent Context Schema
 *
 * Defines the shape of the UI context snapshot sent to the System Agent
 * alongside user messages. This gives the agent awareness of what the user
 * is currently seeing/doing in the application.
 */

export interface SystemAgentContext {
  /** Current active route surface info */
  activeSurface: {
    type: string
    params: Record<string, string | undefined>
    label: string
  } | null

  /** All open route surfaces (just type + label for awareness) */
  openSurfaces: Array<{ type: string, label: string }>

  /** If user is in a chat surface, the session context */
  chatContext: {
    sessionId: string
    status: 'idle' | 'streaming' | 'error'
    messageCount: number
    /** last few message roles/summaries for awareness */
    recentMessages: Array<{ role: string, contentPreview: string }>
  } | null

  /** Layout awareness */
  layout: {
    sidebarCollapsed: boolean
    asideOpen: boolean
    asideActiveTab: string
    bottomPanelOpen: boolean
    settingsOpen: boolean
    settingsSection: string
  }

  /** User's preferred agent profile */
  activeProfileId: string | null

  /** Sessions with unread activity */
  unreadSessionIds: string[]
}
