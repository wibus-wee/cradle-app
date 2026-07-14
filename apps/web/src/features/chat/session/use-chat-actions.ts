import type { FileUIPart, UIMessage } from 'ai'
import { lastAssistantMessageIsCompleteWithApprovalResponses } from 'ai'
import { useCallback, useRef } from 'react'

import { toastManager } from '~/components/ui/toast'
import { submitSideConversationMessage } from '~/features/browser/side-conversation-message'
import { updateSessionInSessionLists } from '~/features/workspace/use-session'
import { useBrowserPanelStore } from '~/store/browser-panel'
import { chatSelectors, useChatStore } from '~/store/chat'

import { runtimeUiSlotStatesQueryKey } from '../capabilities/chat-capabilities'
import { readBangCommand } from '../commands/bang-command'
import { annotateBangCommandMessage, annotateBangResultMessage } from '../commands/bang-command-metadata'
import { cancelChatResponse, createSideChat, enqueueChatSessionQueueItem, executeBangCommand, resolvePlanImplementationApproval, steerChatSessionTurn, submitRuntimeToolApproval, submitRuntimeUserInput } from '../commands/chat-response-command'
import { rollbackLastTurn as rollbackLastTurnCommand } from '../commands/rollback-last-turn-command'
import type { RuntimeSessionStatus } from '../commands/runtime-session-status-command'
import { runtimeSettingsQueryKey, updateSessionRuntimeSettings } from '../commands/runtime-settings-command'
import type { ChatContextPart } from '../context/chat-context-parts'
import { setCodexThreadGoal } from '../runtime/codex-app-server-bridge'
import { runtimeSessionStatusQueryKey, runtimeSessionStatusQueryOptions } from '../runtime/use-runtime-session-status'
import { startChatResponseStream } from '../transport/chat-stream-transport'
import { ChatStreamingHandler } from '../transport/chat-streaming-handler'
import { buildOptimisticUserMessage, readGoalCommandObjective } from './optimistic-chat-turn'
import type { UserMessageDraft } from './read-user-message-draft'
import { readUserMessageDraft } from './read-user-message-draft'
import type { ChatSessionRuntimeControls } from './use-chat-session-runtime-controls'
import type { RuntimeUserInputSubmitInput, SendMessageOptions, SendMessageResult, ToolApprovalResponseInput } from './use-chat-session-types'
import {
  BANG_COMMAND_DRIVER_PREFIX,
  CODEX_PLAN_IMPLEMENTATION_PROMPT_PREFIX,
  isMatchingApprovalPart,
  isMatchingToolPart,
  QUEUE_DRAIN_SYNC_DELAY_MS,
  readLocalDriverMessageId,
  readPlanImplementationApprovalRequest,
  readRuntimeToolApprovalRequest,
  readRuntimeUserInputRequestId,
  readSideChatCommand,
} from './use-chat-session-types'

interface UseChatActionsInput {
  chatSessionId: string | null
  controls: ChatSessionRuntimeControls
  runtimeStatus: RuntimeSessionStatus | null | undefined
  supportsGoalCommand: boolean
  supportsCodexGoalBridge: boolean
}

export function useChatActions(input: UseChatActionsInput) {
  const { chatSessionId, controls, runtimeStatus, supportsGoalCommand, supportsCodexGoalBridge } = input
  const {
    queryClient,
    sessionBindingQueryKey,
    scheduleSnapshotRefresh,
    refreshSessionLists,
    refreshQueue,
  } = controls

  const handlerRef = useRef<ChatStreamingHandler | null>(null)

  // ── Send message ──

  const sendMessage = useCallback(async (
    text: string,
    opts?: SendMessageOptions,
    files: FileUIPart[] = [],
    contextParts: ChatContextPart[] = [],
  ): Promise<SendMessageResult> => {
    const trimmedText = text.trim()
    if (!chatSessionId || (!trimmedText && files.length === 0 && contextParts.length === 0)) {
      return
    }
    const bangCommand = files.length === 0 && contextParts.length === 0 ? readBangCommand(text) : null
    const sideChatMessage = readSideChatCommand(trimmedText)
    const goalObjective = supportsGoalCommand && files.length === 0 && contextParts.length === 0
      ? readGoalCommandObjective(text)
      : null
    const canonicalRuntimeStatus = await queryClient.fetchQuery({
      ...runtimeSessionStatusQueryOptions(chatSessionId),
      staleTime: 0,
    }).catch(() => runtimeStatus ?? null)
    const isBusy = Boolean(
      canonicalRuntimeStatus
      && (
        canonicalRuntimeStatus.status === 'streaming'
        || canonicalRuntimeStatus.status === 'pending'
        || canonicalRuntimeStatus.status === 'cancelling'
        || canonicalRuntimeStatus.activeRun
      ),
    )

    if (sideChatMessage !== null) {
      const controller = new AbortController()
      const driverMessageId = `side-chat-${Date.now()}`
      const store = useChatStore.getState()
      store.appendMessage(chatSessionId, {
        id: driverMessageId,
        role: 'user',
        parts: [{ type: 'text', text: trimmedText }],
      })
      if (!isBusy) {
        store.startGeneration(chatSessionId, driverMessageId, controller)
      }

      try {
        const result = await createSideChat({
          sessionId: chatSessionId,
          providerTargetId: opts?.providerTargetId ?? undefined,
          modelId: opts?.modelId ?? undefined,
          signal: controller.signal,
        })
        useChatStore.getState().removeMessage(chatSessionId, driverMessageId)

        const ownerId = useBrowserPanelStore.getState().activeOwnerId
        useBrowserPanelStore.getState().openSideConversationTab({
          parentSessionId: chatSessionId,
          sideConversationId: result.sideConversationId,
          providerSessionId: result.providerSessionId,
          title: result.title,
          ownerId,
        })
        if (sideChatMessage || files.length > 0 || contextParts.length > 0) {
          await submitSideConversationMessage({
            sideConversationId: result.sideConversationId,
            text: sideChatMessage,
            files,
            contextParts,
            modelId: opts?.modelId ?? undefined,
            thinkingEffort: opts?.thinkingEffort,
            runtimeSettings: opts?.runtimeSettings,
          })
        }

        return {
          kind: 'side-conversation' as const,
          sideConversationId: result.sideConversationId,
          parentSessionId: chatSessionId,
        }
      }
      catch (error) {
        useChatStore.getState().failGeneration(driverMessageId, error instanceof Error ? error.message : 'Failed to create side chat')
        throw error
      }
    }

    if (bangCommand) {
      const controller = new AbortController()
      const driverMessageId = `${BANG_COMMAND_DRIVER_PREFIX}-${Date.now()}`
      const store = useChatStore.getState()
      store.appendMessage(chatSessionId, annotateBangCommandMessage(
        {
          id: driverMessageId,
          role: 'user',
          parts: [{ type: 'text', text: `!${bangCommand}` }],
        },
        bangCommand,
      ))
      if (!isBusy) {
        store.startGeneration(chatSessionId, driverMessageId, controller)
      }
      updateSessionInSessionLists(queryClient, { id: chatSessionId }, { promote: true })

      try {
        const result = await executeBangCommand({
          sessionId: chatSessionId,
          command: bangCommand,
          signal: controller.signal,
        })
        useChatStore.getState().removeMessage(chatSessionId, driverMessageId)
        const latestMessages = useChatStore.getState().messagesMap.get(chatSessionId) ?? []
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
          useChatStore.getState().updateMessage(chatSessionId, userMessage.id, current => annotateBangCommandMessage(current, result.command))
        }
        else {
          useChatStore.getState().appendMessage(chatSessionId, userMessage)
        }
        if (latestMessages.some(message => message.id === resultMessage.id)) {
          useChatStore.getState().updateMessage(chatSessionId, resultMessage.id, current => annotateBangResultMessage(current, {
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
          useChatStore.getState().appendMessage(chatSessionId, resultMessage)
        }
        useChatStore.getState().finishGeneration(driverMessageId)
        scheduleSnapshotRefresh(0)
        refreshSessionLists()
      }
      catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          if (!isBusy) {
            useChatStore.getState().finishGeneration(driverMessageId)
          }
        }
        else {
          const errorMessage = err instanceof Error ? err.message : 'Bang command failed'
          if (isBusy) {
            useChatStore.getState().updateMessage(chatSessionId, driverMessageId, message => ({
              ...message,
              parts: [{ type: 'text', text: `!${bangCommand}\n\n${errorMessage}` }],
            }))
          }
          else {
            useChatStore.getState().failGeneration(driverMessageId, errorMessage)
          }
        }
      }
      return
    }

    const startNewResponse = async () => {
      const userMessageId = `user-${Date.now()}`
      useChatStore.getState().appendMessage(chatSessionId, buildOptimisticUserMessage({
        messageId: userMessageId,
        text: trimmedText,
        sourceText: text,
        files,
        contextParts,
        supportsGoalCommand,
      }))
      updateSessionInSessionLists(queryClient, { id: chatSessionId }, { promote: true })

      const assistantMessageId = `assistant-${Date.now()}`
      const controller = new AbortController()
      const requestStartedAtMs = performance.now()
      const handler = new ChatStreamingHandler(chatSessionId, assistantMessageId, requestStartedAtMs)
      handler.start(controller)
      handlerRef.current = handler
      let acceptedByServer = false

      try {
        const transport = await startChatResponseStream({
          sessionId: chatSessionId,
          body: {
            text: trimmedText,
            files,
            contextParts,
            providerTargetId: opts?.providerTargetId,
            modelId: opts?.modelId ?? undefined,
            thinkingEffort: opts?.thinkingEffort === null ? undefined : opts?.thinkingEffort,
            runtimeSettings: opts?.runtimeSettings,
          },
          signal: controller.signal,
        })
        acceptedByServer = true

        scheduleSnapshotRefresh(0)

        const acceptedAtMs = performance.now()
        const store = useChatStore.getState()
        if (transport.runId) {
          store.setRunDisplayId(assistantMessageId, transport.runId)
        }
        store.markRunAccepted(assistantMessageId, acceptedAtMs)

        if (sessionBindingQueryKey) {
          void queryClient.invalidateQueries({ queryKey: sessionBindingQueryKey })
        }
        refreshSessionLists()

        await handler.consume(transport.stream)
        handler.finish()
      }
      catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          handler.finish('aborted')
        }
        else if (!acceptedByServer) {
          // Always close the analytics task, even when the UI rolls back the optimistic turn.
          handler.fail(err instanceof Error ? err.message : 'Stream failed')
          const store = useChatStore.getState()
          store.removeMessage(chatSessionId, assistantMessageId)
          store.removeMessage(chatSessionId, userMessageId)
          throw err
        }
        else {
          handler.fail(err instanceof Error ? err.message : 'Stream failed')
        }
      }
      finally {
        const wasLocallyAborted = controller.signal.aborted
        handlerRef.current = null
        if (!wasLocallyAborted && acceptedByServer) {
          scheduleSnapshotRefresh(0)
          void queryClient.invalidateQueries({ queryKey: runtimeUiSlotStatesQueryKey(chatSessionId) })
          void queryClient.invalidateQueries({ queryKey: runtimeSettingsQueryKey(chatSessionId) })
          refreshQueue(QUEUE_DRAIN_SYNC_DELAY_MS)
        }
      }
    }

    if (isBusy) {
      if (goalObjective && supportsCodexGoalBridge) {
        const latestRuntimeStatus = canonicalRuntimeStatus ?? await queryClient.fetchQuery({
          ...runtimeSessionStatusQueryOptions(chatSessionId),
          staleTime: 0,
        })
        if (latestRuntimeStatus) {
          const threadId = latestRuntimeStatus.providerSessionId
          if (!threadId) {
            throw new Error('Cannot update Codex goal before the provider thread is available.')
          }

          await setCodexThreadGoal({
            sessionId: chatSessionId,
            threadId,
            objective: goalObjective,
            status: 'active',
            providerTargetId: opts?.providerTargetId,
            modelId: opts?.modelId,
          })
          scheduleSnapshotRefresh(0)
          void queryClient.invalidateQueries({ queryKey: runtimeSessionStatusQueryKey(chatSessionId) })
          void queryClient.invalidateQueries({ queryKey: runtimeUiSlotStatesQueryKey(chatSessionId) })
          refreshSessionLists()
          return
        }
      }

      const continuationMode = opts?.continuationMode ?? 'queue'
      const body = {
        text: trimmedText,
        files,
        contextParts,
        providerTargetId: opts?.providerTargetId,
        modelId: opts?.modelId ?? undefined,
        thinkingEffort: opts?.thinkingEffort === null ? undefined : opts?.thinkingEffort,
        runtimeSettings: opts?.runtimeSettings,
      }
      if (continuationMode === 'steer') {
        const steerBody = {
          text: body.text,
          files: body.files,
          contextParts: body.contextParts,
          providerTargetId: body.providerTargetId ?? undefined,
        }
        // Server decides steered-vs-queued (target runtime's `steer` capability, and whether a
        // matching active run exists) and returns a `mode` discriminant, so there's no
        // fallback-error-code catch-and-retry dance here anymore.
        const steer = await steerChatSessionTurn({
          sessionId: chatSessionId,
          body: steerBody,
        })
        if (steer.mode === 'steered') {
          useChatStore.getState().insertLiveSteerMessage(chatSessionId, steer.message)
          scheduleSnapshotRefresh(0)
          return
        }

        refreshQueue()
        toastManager.add({
          type: 'info',
          title: 'Added to queue',
          description: 'This runtime applies guidance on the next turn instead of redirecting the active one, so it was queued instead.',
        })
        return
      }

      await enqueueChatSessionQueueItem({
        sessionId: chatSessionId,
        body,
      })
      refreshQueue()
      return
    }

    await startNewResponse()
  }, [chatSessionId, queryClient, refreshQueue, refreshSessionLists, runtimeStatus, scheduleSnapshotRefresh, sessionBindingQueryKey, supportsCodexGoalBridge, supportsGoalCommand])

  // ── Respond to tool approval ──

  const respondToToolApproval = useCallback(async (response: ToolApprovalResponseInput) => {
    if (!chatSessionId) {
      return
    }

    const store = useChatStore.getState()
    const currentMessages = store.messagesMap.get(chatSessionId) ?? []
    const planImplementationRequest = readPlanImplementationApprovalRequest(currentMessages, response)
    if (planImplementationRequest) {
      const result = await resolvePlanImplementationApproval({
        sessionId: chatSessionId,
        messageId: response.messageId,
        approvalId: response.approvalId,
        approved: response.approved,
      })
      useChatStore.getState().updateMessage(
        chatSessionId,
        response.messageId,
        () => result.message,
        { dirtyToolCallIds: new Set([planImplementationRequest.toolCallId]) },
      )
      scheduleSnapshotRefresh(0)
      if (response.approved) {
        await updateSessionRuntimeSettings({
          sessionId: chatSessionId,
          patch: { interactionMode: 'default' },
        })
        void queryClient.invalidateQueries({ queryKey: runtimeSettingsQueryKey(chatSessionId) })
        await sendMessage(CODEX_PLAN_IMPLEMENTATION_PROMPT_PREFIX, {
          runtimeSettings: { interactionMode: 'default' },
        })
      }
      return
    }

    const runtimeToolApprovalRequest = readRuntimeToolApprovalRequest(currentMessages, response)
    if (runtimeToolApprovalRequest) {
      store.updateMessage(chatSessionId, response.messageId, message => ({
        ...message,
        parts: message.parts.map(part =>
          isMatchingApprovalPart(part, response.approvalId)
            ? {
                ...part,
                state: 'approval-responded',
                approval: {
                  id: response.approvalId,
                  approved: response.approved,
                  ...(response.reason ? { reason: response.reason } : {}),
                },
              } as UIMessage['parts'][number]
            : part),
      }), { dirtyToolCallIds: new Set([runtimeToolApprovalRequest.toolCallId]) })
      await submitRuntimeToolApproval({
        sessionId: chatSessionId,
        requestId: runtimeToolApprovalRequest.requestId,
        approved: response.approved,
        reason: response.reason,
      })
      scheduleSnapshotRefresh(0)
      void queryClient.invalidateQueries({ queryKey: runtimeUiSlotStatesQueryKey(chatSessionId) })
      return
    }

    store.updateMessage(chatSessionId, response.messageId, message => ({
      ...message,
      parts: message.parts.map(part =>
        isMatchingApprovalPart(part, response.approvalId)
          ? {
              ...part,
              state: 'approval-responded',
              approval: {
                id: response.approvalId,
                approved: response.approved,
                ...(response.reason ? { reason: response.reason } : {}),
              },
            } as UIMessage['parts'][number]
          : part),
    }))

    const messagesForContinuation = useChatStore.getState().messagesMap.get(chatSessionId) ?? []
    if (!lastAssistantMessageIsCompleteWithApprovalResponses({ messages: messagesForContinuation })) {
      return
    }

    const controller = new AbortController()
    const requestStartedAtMs = performance.now()
    const handler = new ChatStreamingHandler(chatSessionId, response.messageId, requestStartedAtMs)
    handler.start(controller)
    handlerRef.current = handler

    try {
      const transport = await startChatResponseStream({
        sessionId: chatSessionId,
        body: {
          text: '',
          messages: messagesForContinuation,
        },
        signal: controller.signal,
      })

      scheduleSnapshotRefresh(0)

      const acceptedAtMs = performance.now()
      const store = useChatStore.getState()
      if (transport.runId) {
        store.setRunDisplayId(response.messageId, transport.runId)
      }
      store.markRunAccepted(response.messageId, acceptedAtMs)

      if (sessionBindingQueryKey) {
        void queryClient.invalidateQueries({ queryKey: sessionBindingQueryKey })
      }
      refreshSessionLists()

      await handler.consume(transport.stream)
      handler.finish()
    }
    catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        handler.finish('aborted')
      }
      else {
        handler.fail(err instanceof Error ? err.message : 'Approval continuation failed')
      }
    }
    finally {
      handlerRef.current = null
      if (!controller.signal.aborted) {
        scheduleSnapshotRefresh(0)
        void queryClient.invalidateQueries({ queryKey: runtimeUiSlotStatesQueryKey(chatSessionId) })
        void queryClient.invalidateQueries({ queryKey: runtimeSettingsQueryKey(chatSessionId) })
        refreshQueue(QUEUE_DRAIN_SYNC_DELAY_MS)
      }
    }
  }, [chatSessionId, queryClient, refreshQueue, refreshSessionLists, scheduleSnapshotRefresh, sendMessage, sessionBindingQueryKey])

  // ── Submit pending user input ──

  const submitPendingUserInput = useCallback(async (response: RuntimeUserInputSubmitInput) => {
    if (!chatSessionId) {
      return
    }

    const requestId = readRuntimeUserInputRequestId(response.toolCallId)
    const result = await submitRuntimeUserInput({
      sessionId: chatSessionId,
      requestId,
      answers: response.answers,
    })

    useChatStore.getState().updateMessage(chatSessionId, response.messageId, message => ({
      ...message,
      parts: message.parts.map(part =>
        isMatchingToolPart(part, response.toolCallId)
          ? {
              ...part,
              state: 'output-available',
              output: {
                type: 'cradle.runtime-user-input.resolved.v1',
                requestId: result.requestId,
                answers: result.answers,
                acceptedAt: Math.floor(Date.now() / 1000),
              },
            } as UIMessage['parts'][number]
          : part),
    }), { dirtyToolCallIds: new Set([response.toolCallId]) })

    scheduleSnapshotRefresh(0)
  }, [chatSessionId, scheduleSnapshotRefresh])

  // ── Roll back last turn (edit previous message) ──

  const rollbackLastTurn = useCallback(async (): Promise<UserMessageDraft | null> => {
    if (!chatSessionId) {
      return null
    }

    // Capture the last user-authored message before the server removes it, so we
    // can reload it into the Composer as an editable draft once rollback succeeds.
    const messages = useChatStore.getState().messagesMap.get(chatSessionId) ?? []
    const lastUserMessage = [...messages].reverse().find(message => message.role === 'user') ?? null
    const draft = readUserMessageDraft(lastUserMessage)

    const result = await rollbackLastTurnCommand({ sessionId: chatSessionId })

    // Optimistically drop the rolled-back tail so the transcript updates before
    // the canonical snapshot refetch lands. The snapshot refresh reconciles any
    // remaining drift (e.g. ids that differed pre-sync).
    for (const messageId of result.messageIds) {
      useChatStore.getState().removeMessage(chatSessionId, messageId)
    }

    scheduleSnapshotRefresh(0)
    void queryClient.invalidateQueries({ queryKey: runtimeSessionStatusQueryKey(chatSessionId) })
    refreshSessionLists()
    refreshQueue()

    return draft
  }, [chatSessionId, queryClient, refreshQueue, refreshSessionLists, scheduleSnapshotRefresh])

  // ── Stop ──

  const stop = useCallback(async () => {
    if (!chatSessionId) {
      return
    }
    const store = useChatStore.getState()
    const messages = store.messagesMap.get(chatSessionId) ?? []
    const activeAssistant = [...messages].reverse().find(m => m.role === 'assistant' && chatSelectors.isGenerating(m.id)(store))
    const localDriverMessageId = readLocalDriverMessageId(chatSelectors.sessionRunState(chatSessionId)(store))
    const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant')
    const messageId = activeAssistant?.id ?? localDriverMessageId ?? lastAssistant?.id
    if (messageId) {
      store.stopGeneration(messageId, chatSessionId)
    }
    store.setRunCancelling(chatSessionId, true)

    try {
      await cancelChatResponse(chatSessionId)
      scheduleSnapshotRefresh(0)
      refreshQueue()
      refreshQueue(QUEUE_DRAIN_SYNC_DELAY_MS)
    }
    catch (error) {
      store.setRunCancelling(chatSessionId, false)
      console.warn('[useChatSession] failed to cancel server chat response', error)
    }
  }, [chatSessionId, refreshQueue, scheduleSnapshotRefresh])

  return {
    sendMessage,
    respondToToolApproval,
    submitPendingUserInput,
    rollbackLastTurn,
    stop,
  }
}
