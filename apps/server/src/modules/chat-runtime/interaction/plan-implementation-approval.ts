import { messages } from '@cradle/db'
import type { UIMessage } from 'ai'
import { and, eq } from 'drizzle-orm'

import { AppError } from '../../../errors/app-error'
import { readObjectRecord } from '../../../helpers/json-record'
import { readBuiltinToolCallInputPayload } from '../../chat-runtime-providers/tools/tool-call-payload'
import { submitRuntimeToolApprovalIfPending } from '../pending-tool-approval'
import type { ChatMessageStatus } from '../run/stream-chunks'
import { assertStoredSession } from '../runtime-session-context'
import { persistMessageSnapshot, parseStoredMessageSnapshot } from '../stream/projection'
import { db } from '../../../infra'

type MutableToolPart = Extract<UIMessage['parts'][number], { toolCallId: string }>

type MutableApprovalToolPart = MutableToolPart & {
  approval?: {
    id?: unknown
    approved?: unknown
    reason?: unknown
  }
  input?: unknown
  state?: string
  toolName?: string
  type: string
}

export function resolvePlanImplementationApproval(input: {
  sessionId: string
  messageId: string
  approvalId: string
  approved: boolean
}): { message: UIMessage } {
  assertStoredSession(input.sessionId)
  if (!input.approvalId.startsWith('implement-plan:')) {
    throw new AppError({
      code: 'chat_plan_implementation_approval_invalid',
      status: 400,
      message: 'Plan implementation approval id is invalid',
      details: { approvalId: input.approvalId }
    })
  }

  const row = db()
    .select()
    .from(messages)
    .where(and(eq(messages.id, input.messageId), eq(messages.sessionId, input.sessionId)))
    .get()
  if (!row) {
    throw new AppError({
      code: 'chat_message_not_found',
      status: 404,
      message: 'Chat message was not found',
      details: {
        sessionId: input.sessionId,
        messageId: input.messageId
      }
    })
  }
  if (row.role !== 'assistant') {
    throw new AppError({
      code: 'chat_plan_implementation_approval_invalid',
      status: 400,
      message: 'Plan implementation approval must target an assistant message',
      details: {
        sessionId: input.sessionId,
        messageId: input.messageId,
        role: row.role
      }
    })
  }

  const message = parseStoredMessageSnapshot(row, 'assistant')
  const part = findPlanImplementationApprovalPart(message, input.approvalId)
  if (!part) {
    throw new AppError({
      code: 'chat_plan_implementation_approval_not_found',
      status: 404,
      message: 'Plan implementation approval was not found',
      details: {
        sessionId: input.sessionId,
        messageId: input.messageId,
        approvalId: input.approvalId
      }
    })
  }

  part.state = 'approval-responded'
  part.approval = {
    id: input.approvalId,
    approved: input.approved
  }
  submitRuntimeToolApprovalIfPending({
    sessionId: input.sessionId,
    requestId: input.approvalId,
    approved: input.approved,
    reason: input.approved
      ? 'User approved plan implementation.'
      : 'User denied plan implementation.'
  })
  persistMessageSnapshot({
    sessionId: input.sessionId,
    messageId: input.messageId,
    message,
    messageStatus: row.status as ChatMessageStatus,
    errorText: row.errorText
  })

  return { message }
}

function findPlanImplementationApprovalPart(
  message: UIMessage,
  approvalId: string
): MutableApprovalToolPart | null {
  for (const part of message.parts) {
    if (!isToolPartWithApproval(part, approvalId)) {
      continue
    }
    if (part.toolCallId !== approvalId) {
      continue
    }
    if (readToolPartApiName(part) !== 'plan_implementation') {
      continue
    }
    if (!readPlanImplementationContent(part)) {
      continue
    }
    return part
  }
  return null
}

function isToolPartWithApproval(
  part: UIMessage['parts'][number],
  approvalId: string
): part is MutableApprovalToolPart {
  if (!('toolCallId' in part) || typeof part.toolCallId !== 'string') {
    return false
  }
  if (part.type !== 'dynamic-tool' && !part.type.startsWith('tool-')) {
    return false
  }
  const approval = (part as MutableApprovalToolPart).approval
  return typeof approval?.id === 'string' && approval.id === approvalId
}

function readToolPartApiName(part: MutableApprovalToolPart): string | null {
  const inputPayload = readBuiltinToolCallInputPayload(part.input)
  if (inputPayload) {
    return inputPayload.apiName
  }
  if (typeof part.toolName === 'string') {
    return part.toolName
  }
  return part.type.startsWith('tool-') ? part.type.slice('tool-'.length) : null
}

function readPlanImplementationContent(part: MutableApprovalToolPart): string | null {
  const inputPayload = readBuiltinToolCallInputPayload(part.input)
  const args = readObjectRecord(inputPayload?.args ?? part.input)
  const planContent = args.planContent
  return typeof planContent === 'string' && planContent.trim().length > 0 ? planContent : null
}
