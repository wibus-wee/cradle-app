import { Elysia } from 'elysia'

import { releaseSideConversation } from '../../provider-runtime/side-conversation-registry'
import { ChatRuntimeModel } from '../model'
import { submitRuntimeToolApproval } from '../pending-tool-approval'
import { submitRuntimeUserInput } from '../pending-user-input'
import { readOptionalModelId } from './request-normalizers'
import { loadChatRuntime } from './runtime-loader'

const EVENT_STREAM_HEADERS = {
  'content-type': 'text/event-stream',
  'cache-control': 'no-cache',
  connection: 'keep-alive'
} as const

export const chatRuntimeInteractionRoutes = new Elysia({
  detail: { tags: ['chat-runtime'] }
})
  // POST /chat/sessions/:sessionId/bang-command -> execute a user-entered command through the session runtime and persist transcript context
  .post(
    '/sessions/:sessionId/bang-command',
    async ({ params, body, request }) => {
      return await (
        await loadChatRuntime()
      ).executeBangCommand({
        sessionId: params.sessionId,
        command: body.command,
        signal: request.signal
      })
    },
    {
      detail: {
        summary: 'Execute a user-entered shell command and persist the output as chat context'
      },
      params: ChatRuntimeModel.sessionIdParams,
      body: ChatRuntimeModel.bangCommandBody,
      response: { 200: ChatRuntimeModel.bangCommandResponse }
    }
  )
  // POST /chat/sessions/:sessionId/side-chat -> fork a live-only provider side conversation from the current chat session
  .post(
    '/sessions/:sessionId/side-chat',
    async ({ params, body }) => {
      return await (
        await loadChatRuntime()
      ).createSideChat({
        parentSessionId: params.sessionId,
        providerTargetId: body.providerTargetId?.trim() || undefined,
        modelId: readOptionalModelId(body.modelId)
      })
    },
    {
      detail: {
        summary: 'Create a live-only side conversation from the current session'
      },
      params: ChatRuntimeModel.sessionIdParams,
      body: ChatRuntimeModel.sideChatBody,
      response: { 200: ChatRuntimeModel.sideChatResponse }
    }
  )
  // POST /chat/sessions/:sessionId/quick-question -> stream a stateless quick question (no tools, not persisted)
  .post(
    '/sessions/:sessionId/quick-question',
    async ({ params, body }) => {
      const stream = await (
        await loadChatRuntime()
      ).streamQuickQuestion({
        sessionId: params.sessionId,
        question: body.question
      })
      return new Response(stream, {
        headers: EVENT_STREAM_HEADERS
      })
    },
    {
      detail: {
        summary: 'Stream a quick question without persisting to history (no tools)',
        responses: {
          200: {
            description: 'Server-sent event stream with AI SDK UIMessageChunk JSON frames',
            content: {
              'text/event-stream': {
                schema: { type: 'string' }
              }
            }
          }
        }
      },
      params: ChatRuntimeModel.sessionIdParams,
      body: ChatRuntimeModel.quickQuestionBody
    }
  )
  // POST /chat/sessions/:sessionId/user-input/:requestId -> resolve a provider pending user input request
  .post(
    '/sessions/:sessionId/user-input/:requestId',
    async ({ params, body }) => {
      return await submitRuntimeUserInput({
        sessionId: params.sessionId,
        requestId: params.requestId,
        answers: body.answers
      })
    },
    {
      detail: {
        summary: 'Submit answers for a pending runtime user input request'
      },
      params: ChatRuntimeModel.userInputParams,
      body: ChatRuntimeModel.userInputBody,
      response: { 200: ChatRuntimeModel.userInputResponse }
    }
  )
  // POST /chat/sessions/:sessionId/tool-approval/:requestId -> resolve a provider pending tool approval request
  .post(
    '/sessions/:sessionId/tool-approval/:requestId',
    async ({ params, body }) => {
      return await submitRuntimeToolApproval({
        sessionId: params.sessionId,
        requestId: params.requestId,
        approved: body.approved,
        reason: body.reason
      })
    },
    {
      detail: {
        summary: 'Submit a decision for a pending runtime tool approval request'
      },
      params: ChatRuntimeModel.toolApprovalParams,
      body: ChatRuntimeModel.toolApprovalBody,
      response: { 200: ChatRuntimeModel.toolApprovalResponse }
    }
  )
  // DELETE /chat/side-conversations/:sideConversationId -> release a live side conversation
  .delete(
    '/side-conversations/:sideConversationId',
    async ({ params }) => {
      releaseSideConversation(params.sideConversationId)
      return { ok: true as const }
    },
    {
      detail: {
        summary: 'Release a live-only side conversation'
      },
      params: ChatRuntimeModel.sideConversationParams,
      response: { 200: ChatRuntimeModel.cancelResponse }
    }
  )
  // POST /chat/sessions/:sessionId/messages/:messageId/plan-implementation-approval -> resolve a synthetic provider plan implementation approval
  .post(
    '/sessions/:sessionId/messages/:messageId/plan-implementation-approval',
    async ({ params, body }) => {
      return (await loadChatRuntime()).resolvePlanImplementationApproval({
        sessionId: params.sessionId,
        messageId: params.messageId,
        approvalId: body.approvalId,
        approved: body.approved
      })
    },
    {
      detail: {
        summary: 'Resolve a synthetic provider plan implementation approval'
      },
      params: ChatRuntimeModel.planImplementationApprovalParams,
      body: ChatRuntimeModel.planImplementationApprovalBody,
      response: { 200: ChatRuntimeModel.planImplementationApprovalResponse }
    }
  )
