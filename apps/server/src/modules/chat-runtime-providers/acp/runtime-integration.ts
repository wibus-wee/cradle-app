import { randomUUID } from 'node:crypto'

import type { ElicitationFormMode } from '@agentclientprotocol/sdk'
import {
  CreateElicitationRequest,
  ElicitationPropertySchema,
  MultiSelectItems,
} from '@agentclientprotocol/sdk'

import * as ChatRuntime from '../../chat-runtime/runtime'
import type {
  ProviderContext,
  RuntimeUserInputQuestion,
  RuntimeUserInputResolution,
} from '../../chat-runtime/runtime-provider-types'
import { listChatSessionIdsByDurableProviderSession } from '../../provider-runtime/service'
import { requestProviderToolApproval } from '../kit/permission-bridge'
import type {
  AcpConnectionManager,
  AcpElicitationRequest,
  AcpPermissionRequest,
  AcpPermissionResponse,
} from './connection-manager'

export interface AcpIntegrationOptions {
  deps: Pick<ProviderContext, 'requestToolApproval' | 'requestUserInput' | 'resolveUserInput'>
}

type AcpIntegrationRuntime = Pick<
  AcpConnectionManager,
  'onSessionTitle' | 'setElicitationCompleteHandler' | 'setElicitationHandler' | 'setPermissionHandler'
>

export function wireAcpIntegration(runtime: AcpIntegrationRuntime, options: AcpIntegrationOptions): void {
  const pendingUrlElicitations = new Map<string, { sessionId: string, requestId: string }>()
  runtime.setPermissionHandler(request => handlePermission(request, options))
  runtime.setElicitationHandler(request => handleElicitation(request, options, pendingUrlElicitations))
  runtime.setElicitationCompleteHandler(async ({ agentId, params }) => {
    const key = toElicitationKey(agentId, params.elicitationId)
    const pending = pendingUrlElicitations.get(key)
    if (!pending || !options.deps.resolveUserInput) { return }
    pendingUrlElicitations.delete(key)
    await options.deps.resolveUserInput({
      sessionId: pending.sessionId,
      requestId: pending.requestId,
      answers: { complete: [] },
    })
  })
  runtime.onSessionTitle((acpSessionId, title) => {
    handleSessionTitle(acpSessionId, title)
  })
}

async function handleElicitation(
  request: AcpElicitationRequest,
  options: AcpIntegrationOptions,
  pendingUrlElicitations: Map<string, { sessionId: string, requestId: string }>,
) {
  const runtimeContext = request.runtimeContext
  const requestUserInput = options.deps.requestUserInput
  const sessionId = 'sessionId' in request.params && typeof request.params.sessionId === 'string'
    ? request.params.sessionId
    : null
  if (!runtimeContext || !requestUserInput || !sessionId) {
    return { action: 'decline' as const }
  }

  const providerRequestId = `acp-elicitation-${randomUUID()}`
  let questions: RuntimeUserInputQuestion[] = []
  if (CreateElicitationRequest.isForm(request.params)) {
    questions = projectElicitationQuestions(request.params)
  }
  else if (CreateElicitationRequest.isUrl(request.params)) {
    questions = [{
      id: 'complete',
      header: 'Continue',
      question: request.params.message,
      isOther: false,
      isSecret: false,
      multiSelect: false,
      options: [{ label: 'Open link', description: request.params.url, url: request.params.url }],
    }]
  }
  if (questions.length === 0) { return { action: 'decline' as const } }
  const toolCallId = 'toolCallId' in request.params && typeof request.params.toolCallId === 'string'
    ? request.params.toolCallId
    : providerRequestId

  const elicitationKey = CreateElicitationRequest.isUrl(request.params)
    ? toElicitationKey(request.agentId, request.params.elicitationId)
    : null
  if (elicitationKey) {
    pendingUrlElicitations.set(elicitationKey, {
      sessionId: runtimeContext.chatSessionId,
      requestId: providerRequestId,
    })
  }

  let resolution: RuntimeUserInputResolution
  try {
    resolution = await requestUserInput({
      sessionId: runtimeContext.chatSessionId,
      runId: runtimeContext.runId,
      providerRequestId,
      providerKind: runtimeContext.providerKind,
      runtimeKind: runtimeContext.runtimeKind,
      providerMethod: 'elicitation/create',
      toolCallId,
      questions,
      metadata: { agentId: request.agentId, mode: request.params.mode },
    })
  }
  finally {
    if (elicitationKey) { pendingUrlElicitations.delete(elicitationKey) }
  }

  if (!CreateElicitationRequest.isForm(request.params)) { return { action: 'accept' as const } }
  const properties = request.params.requestedSchema.properties ?? {}
  return {
    action: 'accept' as const,
    content: Object.fromEntries(Object.entries(resolution.answers).map(([id, answers]) => {
      const property = properties[id]
      const first = answers[0] ?? ''
      if (property?.type === 'array') { return [id, answers] }
      if (property?.type === 'boolean') { return [id, first === 'true'] }
      if (property?.type === 'number' || property?.type === 'integer') { return [id, Number(first)] }
      return [id, first]
    })),
  }
}

function toElicitationKey(agentId: string, elicitationId: string): string {
  return `${agentId}:${elicitationId}`
}

function projectElicitationQuestions(
  params: ElicitationFormMode & { mode: 'form', message: string },
): RuntimeUserInputQuestion[] {
  return Object.entries(params.requestedSchema.properties ?? {}).map(([id, property]) => {
    const oneOf = ElicitationPropertySchema.isString(property) ? property.oneOf ?? [] : []
    const enumValues = ElicitationPropertySchema.isString(property) ? property.enum ?? [] : []
    const items = ElicitationPropertySchema.isArray(property) ? property.items : null
    const itemOneOf = items && MultiSelectItems.isTitled(items) ? items.anyOf : []
    const itemEnum = items && MultiSelectItems.isString(items) ? items.enum ?? [] : []
    const options = [
      ...oneOf.map(option => ({ label: option.const, description: option.description ?? option.title })),
      ...enumValues.map(value => ({ label: value, description: value })),
      ...itemOneOf.map(option => ({ label: option.const, description: option.description ?? option.title })),
      ...itemEnum.map(value => ({ label: value, description: value })),
    ]
    const supportedProperty = ElicitationPropertySchema.isString(property)
      || ElicitationPropertySchema.isNumber(property)
      || ElicitationPropertySchema.isInteger(property)
      || ElicitationPropertySchema.isBoolean(property)
      || ElicitationPropertySchema.isArray(property)
      ? property
      : null
    return {
      id,
      header: supportedProperty?.title ?? params.requestedSchema.title ?? 'Input',
      question: supportedProperty?.description ?? params.message,
      isOther: options.length === 0,
      isSecret: false,
      multiSelect: ElicitationPropertySchema.isArray(property),
      options: options.length > 0 ? options : null,
    }
  })
}

async function handlePermission(
  request: AcpPermissionRequest,
  options: AcpIntegrationOptions,
): Promise<AcpPermissionResponse> {
  const runtimeContext = request.runtimeContext
  const chatSessionId = runtimeContext?.chatSessionId ?? listChatSessionIdsByDurableProviderSession(request.sessionId)[0] ?? null
  if (!runtimeContext) {
    console.warn('[acp] permission request denied because active runtime context is unavailable', {
      agentId: request.agentId,
      chatSessionId,
      toolTitle: request.toolTitle,
    })
    return denyAcpPermission(request)
  }

  try {
    const resolution = await requestProviderToolApproval({
      deps: options.deps,
      sessionId: runtimeContext.chatSessionId,
      runId: runtimeContext.runId,
      providerRequestId: request.providerRequestId,
      providerKind: runtimeContext.providerKind,
      runtimeKind: runtimeContext.runtimeKind,
      providerMethod: request.providerMethod,
      toolCallId: request.toolCallId,
      options: request.options.map(option => ({
        optionId: option.optionId,
        label: option.name,
        kind: option.kind as 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always',
      })),
      metadata: {
        acpSessionId: request.sessionId,
        agentId: request.agentId,
        toolTitle: request.toolTitle,
        options: request.options,
      },
    })

    if (resolution.selectedOptionId) {
      return request.options.some(option => option.optionId === resolution.selectedOptionId)
        ? { outcome: 'selected', optionId: resolution.selectedOptionId }
        : { outcome: 'cancelled' }
    }
    return selectAcpPermissionByKind(request, resolution.approved, resolution.scope)
  }
  catch (error) {
    console.warn('[acp] permission request denied because runtime approval failed', {
      agentId: request.agentId,
      chatSessionId,
      toolTitle: request.toolTitle,
      error,
    })
    return denyAcpPermission(request)
  }
}

function handleSessionTitle(acpSessionId: string, title: string): void {
  for (const chatSessionId of listChatSessionIdsByDurableProviderSession(acpSessionId)) {
    void ChatRuntime.reportRuntimeSessionTitle({ sessionId: chatSessionId, title }).catch(
      (error) => {
        console.warn('[acp] session title persistence failed', {
          acpSessionId,
          chatSessionId,
          error,
        })
      },
    )
  }
}

function denyAcpPermission(request: AcpPermissionRequest): AcpPermissionResponse {
  const rejectOption = request.options.find(
    option => option.kind === 'reject_once' || option.kind === 'reject_always',
  )
  return rejectOption
    ? { outcome: 'selected', optionId: rejectOption.optionId }
    : { outcome: 'cancelled' }
}

function selectAcpPermissionByKind(
  request: AcpPermissionRequest,
  approved: boolean,
  scope: 'once' | 'always' = 'once',
): AcpPermissionResponse {
  const kind = `${approved ? 'allow' : 'reject'}_${scope}`
  const option = request.options.find(candidate => candidate.kind === kind)
  return option ? { outcome: 'selected', optionId: option.optionId } : { outcome: 'cancelled' }
}
