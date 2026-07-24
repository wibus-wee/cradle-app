import { useSearch } from '@tanstack/react-router'

import { useSurfaceActive } from '~/navigation/surface-activity-context'

import { NewChatEntryPoint } from './new-chat-entry-point'

export { NewChatEntryPoint } from './new-chat-entry-point'

/** Route adapter for the New Chat entry surface. */
export function NewChatPage() {
  const isActive = useSurfaceActive()
  const search = useSearch({ from: '/chat/new' })
  return (
    <NewChatEntryPoint
      active={isActive}
      issueId={search.issueId ?? null}
      initialWorkspaceId={search.workspaceId ?? null}
      sessionGroupId={search.sessionGroupId ?? null}
    />
  )
}
