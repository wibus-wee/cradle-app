export type ChatRuntimeService = typeof import('../runtime')

let chatRuntimeService: Promise<ChatRuntimeService> | null = null

export async function loadChatRuntime(): Promise<ChatRuntimeService> {
  chatRuntimeService ??= import('../runtime')
  return await chatRuntimeService
}
