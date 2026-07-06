import type { UIMessage } from 'ai'

import { AppError } from '../../../errors/app-error'
import { readObjectRecord } from '../../../helpers/json-record'
import { readBuiltinToolCallInputPayload } from '../../chat-runtime-providers/tools/tool-call-payload'

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

export function assertPlanImplementationApprovalId(approvalId: string): void {
  if (!approvalId.startsWith('implement-plan:')) {
    throw new AppError({
      code: 'chat_plan_implementation_approval_invalid',
      status: 400,
      message: 'Plan implementation approval id is invalid',
      details: { approvalId },
    })
  }
}

export function applyPlanImplementationApprovalResponse(input: {
  message: UIMessage
  sessionId: string
  messageId: string
  approvalId: string
  approved: boolean
}): UIMessage {
  const part = findPlanImplementationApprovalPart(input.message, input.approvalId)
  if (!part) {
    throw new AppError({
      code: 'chat_plan_implementation_approval_not_found',
      status: 404,
      message: 'Plan implementation approval was not found',
      details: {
        sessionId: input.sessionId,
        messageId: input.messageId,
        approvalId: input.approvalId,
      },
    })
  }

  part.state = 'approval-responded'
  part.approval = {
    id: input.approvalId,
    approved: input.approved,
  }
  return input.message
}

function findPlanImplementationApprovalPart(
  message: UIMessage,
  approvalId: string,
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
  approvalId: string,
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
