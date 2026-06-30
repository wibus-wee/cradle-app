import { createFileRoute } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'

const NewChatPage = lazy(() => import('~/features/new-chat/new-chat-page').then(module => ({ default: module.NewChatPage })))

export const Route = createFileRoute('/chat/new')({
  component: NewChatRoute,
})

function NewChatRoute() {
  return (
    <Suspense fallback={null}>
      <NewChatPage />
    </Suspense>
  )
}
