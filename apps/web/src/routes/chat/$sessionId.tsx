import { createFileRoute } from '@tanstack/react-router'

import { ChatSessionRouteContent } from '~/features/chat/session/chat-session-route-content'

export const Route = createFileRoute('/chat/$sessionId')({
  component: ChatSessionRoute,
})

function ChatSessionRoute() {
  const { sessionId } = Route.useParams()
  return <ChatSessionRouteContent sessionId={sessionId} />
}
