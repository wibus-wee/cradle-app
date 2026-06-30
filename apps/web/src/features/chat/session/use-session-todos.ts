import type { UIMessage } from 'ai'
import { useMemo } from 'react'

import { chatSelectors, useChatStore } from '~/store/chat'

import type { SessionTodoSnapshot } from '../capabilities/chat-todo-projection'
import { selectTodosFromMessages } from '../capabilities/chat-todo-projection'

const EMPTY_MESSAGES: UIMessage[] = []

export function useSessionTodos(sessionId: string | null, active = true): SessionTodoSnapshot | null {
  const messages = useChatStore(
    active && sessionId ? chatSelectors.messages(sessionId) : () => EMPTY_MESSAGES,
  )
  return useMemo(() => active ? selectTodosFromMessages(messages) : null, [active, messages])
}
