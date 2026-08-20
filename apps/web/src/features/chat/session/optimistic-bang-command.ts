import { useChatStore } from '~/store/chat'

import { annotateBangCommandMessage, annotateBangResultMessage } from '../commands/bang-command-metadata'
import { executeBangCommand } from '../commands/chat-response-command'
import { BANG_COMMAND_DRIVER_PREFIX } from './use-chat-session-types'

interface ExecuteOptimisticBangCommandInput {
  sessionId: string
  command: string
  runtimeBusy?: boolean
  onSuccess?: () => void
  onError?: (error: unknown) => void
}

export async function executeOptimisticBangCommand({
  sessionId,
  command,
  runtimeBusy = false,
  onSuccess,
  onError,
}: ExecuteOptimisticBangCommandInput): Promise<void> {
  const controller = new AbortController()
  const driverMessageId = `${BANG_COMMAND_DRIVER_PREFIX}-${Date.now()}`
  const store = useChatStore.getState()
  store.appendMessage(sessionId, annotateBangCommandMessage(
    {
      id: driverMessageId,
      role: 'user',
      parts: [{ type: 'text', text: `!${command}` }],
    },
    command,
  ))
  if (!runtimeBusy) {
    store.startGeneration(sessionId, driverMessageId, controller)
  }

  try {
    const result = await executeBangCommand({
      sessionId,
      command,
      signal: controller.signal,
    })
    useChatStore.getState().removeMessage(sessionId, driverMessageId)
    const latestMessages = useChatStore.getState().messagesMap.get(sessionId) ?? []
    const userMessage = annotateBangCommandMessage(result.userMessage, result.command)
    const resultMessage = annotateBangResultMessage(result.resultMessage, {
      command: result.command,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      timedOut: result.timedOut,
      truncated: result.truncated,
    })
    if (latestMessages.some(message => message.id === userMessage.id)) {
      useChatStore.getState().updateMessage(sessionId, userMessage.id, current => annotateBangCommandMessage(current, result.command))
    }
    else {
      useChatStore.getState().appendMessage(sessionId, userMessage)
    }
    if (latestMessages.some(message => message.id === resultMessage.id)) {
      useChatStore.getState().updateMessage(sessionId, resultMessage.id, current => annotateBangResultMessage(current, {
        command: result.command,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        timedOut: result.timedOut,
        truncated: result.truncated,
      }))
    }
    else {
      useChatStore.getState().appendMessage(sessionId, resultMessage)
    }
    useChatStore.getState().finishGeneration(driverMessageId)
    onSuccess?.()
  }
  catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      if (!runtimeBusy) {
        useChatStore.getState().finishGeneration(driverMessageId)
      }
      return
    }

    const errorMessage = error instanceof Error ? error.message : 'Bang command failed'
    if (runtimeBusy) {
      useChatStore.getState().updateMessage(sessionId, driverMessageId, message => ({
        ...message,
        parts: [{ type: 'text', text: `!${command}\n\n${errorMessage}` }],
      }))
    }
    else {
      useChatStore.getState().failGeneration(driverMessageId, errorMessage)
    }
    onError?.(error)
  }
}
