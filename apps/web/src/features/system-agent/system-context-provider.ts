import type { ContextItem } from '~/features/context/context-items'
import { estimateContextTokens } from '~/features/context/context-items'
import type { ContextProvider } from '~/features/context/context-registry'
import { readUnreadSessionIdsSnapshot } from '~/features/workspace/use-session'
import { readActiveSurface } from '~/navigation/active-surface'
import { useSurfaceStore } from '~/navigation/surface-store'
import { chatSelectors, useChatStore } from '~/store/chat'
import { useLayoutStore } from '~/store/layout'
import { useNewChatStore } from '~/store/new-chat'
import { useSettingsOverlayStore } from '~/store/settings-overlay'

const OWNER = 'system-agent'
const MAX_RECENT_MESSAGES = 5
const CONTENT_PREVIEW_LENGTH = 120

function createItem(input: Omit<ContextItem, 'createdAt' | 'tokenEstimate'> & { createdAt: number, tokenEstimate?: number }): ContextItem {
  const tokenEstimate = input.tokenEstimate ?? estimateContextTokens([
    input.title,
    input.summary,
    input.content ?? '',
  ].join('\n'))

  return {
    ...input,
    tokenEstimate,
  }
}

function getMessageContentPreview(message: { parts?: Array<{ type: string } & Record<string, unknown>> }): string {
  const text = message.parts
    ?.filter(part => part.type === 'text')
    .map(part => typeof part.text === 'string' ? part.text : '')
    .join('\n')
    .trim()

  if (!text) {
    return '[structured content]'
  }

  return text.slice(0, CONTENT_PREVIEW_LENGTH)
}

function surfaceKindToContextType(kind: string): string {
  if (kind === 'workspace') {
    return 'workspace-detail'
  }
  if (kind === 'kanban') {
    return 'kanban-board'
  }
  if (kind === 'plugin') {
    return 'plugin-panel'
  }
  return kind
}

export function readSystemAgentContextItems(now: number): ContextItem[] {
  const chatState = useChatStore.getState()
  const layoutState = useLayoutStore.getState()
  const settingsState = useSettingsOverlayStore.getState()
  const newChatState = useNewChatStore.getState()
  const surfaceState = useSurfaceStore.getState()
  const unreadSessionIds = readUnreadSessionIdsSnapshot()
  const activeSurface = readActiveSurface()
  const items: ContextItem[] = []

  if (activeSurface) {
    const surfaceType = surfaceKindToContextType(activeSurface.kind)
    const params = Object.entries(activeSurface.route.params ?? {})
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${value}`)
      .join(', ')

    items.push(createItem({
      id: `system-agent:view:${activeSurface.id}`,
      kind: 'view',
      owner: OWNER,
      title: 'Active view',
      summary: `User is viewing ${activeSurface.title} (${surfaceType}).`,
      content: params ? `params: ${params}` : undefined,
      priority: 80,
      freshness: 'live',
      sensitivity: 'workspace',
      createdAt: now,
    }))
  }
  else {
    items.push(createItem({
      id: 'system-agent:view:none',
      kind: 'view',
      owner: OWNER,
      title: 'Active view',
      summary: 'User has no active surface.',
      priority: 40,
      freshness: 'live',
      sensitivity: 'public',
      createdAt: now,
    }))
  }

  if (surfaceState.surfaces.length > 0) {
    items.push(createItem({
      id: 'system-agent:view:open-surfaces',
      kind: 'view',
      owner: OWNER,
      title: 'Open surfaces',
      summary: `Open surfaces: ${surfaceState.surfaces.map(surface => surface.title || surface.kind).join(', ')}.`,
      priority: 35,
      freshness: 'live',
      sensitivity: 'workspace',
      createdAt: now,
    }))
  }

  if (activeSurface?.kind === 'chat' && activeSurface.route.to === '/chat/$sessionId') {
    const sessionId = activeSurface.route.params.sessionId
    const messages = chatSelectors.messages(sessionId)(chatState)
    const status = chatSelectors.visibleStatus(sessionId)(chatState)
    const lastMessage = messages
      .slice(-MAX_RECENT_MESSAGES)
      .map(message => ({
        role: message.role,
        contentPreview: getMessageContentPreview(message),
      }))
      .at(-1)

    items.push(createItem({
      id: `system-agent:history:chat:${sessionId}`,
      kind: 'history',
      owner: OWNER,
      title: 'Active chat summary',
      summary: `Chat session ${sessionId} is ${status} with ${messages.length} message(s).`,
      content: lastMessage
        ? `last message: [${lastMessage.role}] ${lastMessage.contentPreview}`
        : undefined,
      references: [{
        kind: 'chat-session',
        id: sessionId,
        label: sessionId,
      }],
      priority: 70,
      freshness: 'live',
      sensitivity: 'private',
      createdAt: now,
    }))
  }

  const layoutParts: string[] = []
  if (activeSurface?.kind === 'settings') {
    layoutParts.push(`settings section: ${settingsState.settingsSection}`)
  }
  if (layoutState.asideOpen) {
    layoutParts.push(`aside open: ${layoutState.asideActiveTab}`)
  }
  if (layoutState.bottomPanelOpen) {
    layoutParts.push('bottom panel open')
  }
  if (layoutState.sidebarCollapsed) {
    layoutParts.push('sidebar collapsed')
  }

  if (layoutParts.length > 0) {
    items.push(createItem({
      id: 'system-agent:layout:notable',
      kind: 'layout',
      owner: OWNER,
      title: 'Layout',
      summary: layoutParts.join(', '),
      priority: 25,
      freshness: 'live',
      sensitivity: 'public',
      createdAt: now,
    }))
  }

  if (unreadSessionIds.length > 0) {
    items.push(createItem({
      id: 'system-agent:attention:unread-sessions',
      kind: 'attention',
      owner: OWNER,
      title: 'Unread sessions',
      summary: `${unreadSessionIds.length} session(s) have unread activity.`,
      priority: 30,
      freshness: 'recent',
      sensitivity: 'private',
      createdAt: now,
    }))
  }

  if (newChatState.lastAgentProfileId) {
    items.push(createItem({
      id: `system-agent:entity:profile:${newChatState.lastAgentProfileId}`,
      kind: 'entity',
      owner: OWNER,
      title: 'Active Jarvis profile',
      summary: `Active profile: ${newChatState.lastAgentProfileId}.`,
      priority: 20,
      freshness: 'recent',
      sensitivity: 'private',
      createdAt: now,
    }))
  }

  return items
}

export function createSystemAgentContextProvider(): ContextProvider {
  return {
    owner: OWNER,
    readContext(input) {
      return readSystemAgentContextItems(input.now)
    },
  }
}
