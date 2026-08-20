import { useLocalSearchParams } from 'expo-router'

import { ChatContainer } from '@/features/chat/ChatContainer'

export default function SessionRoute() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>()
  return <ChatContainer sessionId={sessionId} />
}
