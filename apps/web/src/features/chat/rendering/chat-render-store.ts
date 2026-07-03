import type { ReactNode } from 'react'
import { createContext, createElement, useContext } from 'react'

import type { ChatState } from '~/store/chat'
import { useChatStore } from '~/store/chat'

export type ChatRenderStore = typeof useChatStore

const ChatRenderStoreContext = createContext<ChatRenderStore | null>(null)

export function ChatRenderStoreProvider({
  store,
  children,
}: {
  store: ChatRenderStore
  children: ReactNode
}) {
  return createElement(ChatRenderStoreContext.Provider, { value: store }, children)
}

export function useChatRenderStore<T>(
  selector: (state: ChatState) => T,
  equalityFn?: (left: T, right: T) => boolean,
): T {
  const store = useContext(ChatRenderStoreContext) ?? useChatStore
  return store(selector, equalityFn)
}

export function useChatRenderStoreApi(): ChatRenderStore {
  return useContext(ChatRenderStoreContext) ?? useChatStore
}
