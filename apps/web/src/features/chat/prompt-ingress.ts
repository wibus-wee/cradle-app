import type { FileUIPart } from 'ai'

import type { ChatContextPart } from './context/chat-context-parts'

export interface ChatPromptIngressPayload {
  text: string
  files: FileUIPart[]
  contextParts?: ChatContextPart[]
}

export type ChatPromptIngressHandler = (payload: ChatPromptIngressPayload) => void
export type ChatComposerFileIngressHandler = (files: FileUIPart[]) => void

const handlers = new Map<string, ChatPromptIngressHandler>()
const fileHandlers = new Map<string, ChatComposerFileIngressHandler>()

export function registerChatPromptIngressHandler(
  sessionId: string,
  handler: ChatPromptIngressHandler,
): () => void {
  handlers.set(sessionId, handler)
  return () => {
    if (handlers.get(sessionId) === handler) {
      handlers.delete(sessionId)
    }
  }
}

export function submitChatPromptIngress(
  sessionId: string,
  payload: ChatPromptIngressPayload,
): boolean {
  const handler = handlers.get(sessionId)
  if (!handler) {
    return false
  }
  handler(payload)
  return true
}

export function registerChatComposerFileIngressHandler(
  sessionId: string,
  handler: ChatComposerFileIngressHandler,
): () => void {
  fileHandlers.set(sessionId, handler)
  return () => {
    if (fileHandlers.get(sessionId) === handler) {
      fileHandlers.delete(sessionId)
    }
  }
}

export function submitChatComposerFileIngress(
  sessionId: string,
  files: FileUIPart[],
): boolean {
  const handler = fileHandlers.get(sessionId)
  if (!handler) {
    return false
  }
  handler(files)
  return true
}
