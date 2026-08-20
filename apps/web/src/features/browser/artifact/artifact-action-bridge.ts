import { submitChatPromptIngress } from '~/features/chat/prompt-ingress'

/** Bridge Artifact ActionButtons into the session's chat prompt ingress. */
export function requestArtifactPrompt(input: { sessionId: string, prompt: string }): boolean {
  return submitChatPromptIngress(input.sessionId, {
    text: input.prompt,
    files: [],
  })
}
