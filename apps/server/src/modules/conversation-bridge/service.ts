import { randomUUID } from 'node:crypto'

import {
  conversationBridgeChannelBindings,
  conversationBridgeConnections,
  conversationBridgeDeliveryAttempts,
  conversationBridgeInboundEvents,
  conversationBridgeThreadBindings,
  messages,
  type ConversationBridgeChannelBinding,
  type ConversationBridgeConnection,
  type ConversationBridgeDeliveryAttempt,
  type ConversationBridgeThreadBinding
} from '@cradle/db'
import {
  CONVERSATION_BRIDGE_CHANNEL_UNBIND_ACTION,
  CONVERSATION_BRIDGE_SESSION_MODEL_SELECT_ACTION,
  CONVERSATION_BRIDGE_SESSION_TARGET_SELECT_ACTION,
  CONVERSATION_BRIDGE_STATUS_REFRESH_ACTION,
  CONVERSATION_BRIDGE_WORKSPACE_SELECT_ACTION,
  type ConversationBridgeControlBlock,
  type ConversationBridgeControlElement,
  type ConversationBridgeControlOption,
  type ConversationBridgeControlResponse,
  type NormalizedConversationControl,
  type NormalizedConversationInboundMessage
} from '@cradle/plugin-sdk/server'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { AppError } from '../../errors/app-error'
import { parseJsonObjectOrEmpty } from '../../helpers/json-record'
import { currentUnixSeconds } from '../../helpers/time'
import { db } from '../../infra'
import { listConversationBridgeAdapters } from '../../plugins/conversation-adapter-registry'
import * as Agents from '../agent-identity/service'
import { listRuntimeCatalog } from '../chat-runtime/chat-runtime-provider-registry'
import * as ChatRuntime from '../chat-runtime/runtime'
import { extractMessageText, parseStoredMessageSnapshot } from '../chat-runtime/ui-message'
import { getCachedModelsForTarget } from '../provider-catalog/model-cache'
import type { RuntimeKind } from '../provider-contracts/types'
import * as ProviderTargets from '../provider-targets/service'
import * as Session from '../session/service'
import * as Workspace from '../workspace/service'
import { deliverBridgeMessage } from './runtime-supervisor'

const JsonRecordSchema = z.record(z.string(), z.unknown())

export interface ConversationBridgeAdapterView {
  key: string
  owner: string
  id: string
  platform: string
  label: string
  description: string | null
  capabilities: Record<string, unknown>
  registeredAt: number
}

export interface ConversationBridgeConnectionView extends Omit<
  ConversationBridgeConnection,
  'secretRefsJson' | 'configJson'
> {
  secretRefs: Record<string, unknown>
  config: Record<string, unknown>
}

export interface ConversationBridgeChannelBindingView extends Omit<
  ConversationBridgeChannelBinding,
  'metadataJson'
> {
  metadata: Record<string, unknown>
}

export interface ConversationBridgeThreadBindingView extends Omit<
  ConversationBridgeThreadBinding,
  'metadataJson'
> {
  metadata: Record<string, unknown>
}

export interface ConversationBridgeDeliveryAttemptView extends Omit<
  ConversationBridgeDeliveryAttempt,
  'payloadJson'
> {
  payload: Record<string, unknown>
}

export interface CreateConnectionInput {
  platform: string
  adapterOwner: string
  adapterId: string
  displayName: string
  enabled?: boolean
  secretRefs?: Record<string, unknown>
  config?: Record<string, unknown>
}

export interface UpdateConnectionInput {
  id: string
  displayName?: string
  enabled?: boolean
  secretRefs?: Record<string, unknown>
  config?: Record<string, unknown>
}

export interface BindChannelInput {
  connectionId: string
  externalWorkspaceId: string
  externalChannelId: string
  cradleWorkspaceId: string
  sessionAgentId?: string | null
  sessionProviderTargetId?: string | null
  sessionRuntimeKind?: string | null
  sessionModelId?: string | null
  boundByExternalActorId?: string | null
  metadata?: Record<string, unknown>
}

interface SessionTargetSummary {
  kind: 'agent' | 'provider-target'
  id: string
  label: string
  description: string | null
  runtimeKind: string | null
  runtimeLabel?: string | null
  providerTargetId: string | null
  modelId: string | null
}

interface ProviderModelSummary {
  id: string
  label: string
}

type WorkspaceSummary = Workspace.WorkspaceView

interface StatusConversation {
  externalThreadId: string
  sessionId: string
  sessionTitle: string | null
}

const CONTROL_OPTION_LIMIT = 100
const DEFAULT_MODEL_VALUE = '__cradle_default_model__'

function now(): number {
  return currentUnixSeconds()
}

function stringifyRecord(value: Record<string, unknown> | undefined): string {
  return JSON.stringify(JsonRecordSchema.parse(value ?? {}))
}

function toConnectionView(row: ConversationBridgeConnection): ConversationBridgeConnectionView {
  const { secretRefsJson, configJson, ...rest } = row
  return {
    ...rest,
    secretRefs: parseJsonObjectOrEmpty(secretRefsJson),
    config: parseJsonObjectOrEmpty(configJson)
  }
}

function toChannelBindingView(
  row: ConversationBridgeChannelBinding
): ConversationBridgeChannelBindingView {
  const { metadataJson, ...rest } = row
  return {
    ...rest,
    metadata: parseJsonObjectOrEmpty(metadataJson)
  }
}

function toThreadBindingView(
  row: ConversationBridgeThreadBinding
): ConversationBridgeThreadBindingView {
  const { metadataJson, ...rest } = row
  return {
    ...rest,
    metadata: parseJsonObjectOrEmpty(metadataJson)
  }
}

function toDeliveryAttemptView(
  row: ConversationBridgeDeliveryAttempt
): ConversationBridgeDeliveryAttemptView {
  const { payloadJson, ...rest } = row
  return {
    ...rest,
    payload: parseJsonObjectOrEmpty(payloadJson)
  }
}

function titleFromText(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return 'External conversation'
  }
  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized
}

function buildProvenanceText(event: NormalizedConversationInboundMessage): string {
  const actor = event.externalActorId ? `External actor: ${event.externalActorId}\n` : ''
  return `${actor}External channel: ${event.externalChannelId}\nExternal thread: ${event.externalThreadId}\n\n${event.text}`
}

function parseControlCommand(text: string | undefined): string[] {
  return (text ?? '').trim().split(/\s+/).filter(Boolean)
}

function escapePresentationText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function truncatePresentationText(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text
}

function shortId(id: string): string {
  return id.length > 16 ? `${id.slice(0, 8)}...${id.slice(-4)}` : id
}

function dateFromExternalThreadId(externalThreadId: string): string {
  const seconds = Number(externalThreadId.split('.')[0])
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return 'an earlier external conversation'
  }
  return new Date(seconds * 1000).toLocaleString('en-US')
}

function headerBlock(text: string): ConversationBridgeControlBlock {
  return { type: 'header', text }
}

function sectionBlock(
  text: string,
  accessory?: ConversationBridgeControlElement
): ConversationBridgeControlBlock {
  return accessory ? { type: 'section', text, accessory } : { type: 'section', text }
}

function contextBlock(text: string): ConversationBridgeControlBlock {
  return { type: 'context', text }
}

function dividerBlock(): ConversationBridgeControlBlock {
  return { type: 'divider' }
}

function actionsBlock(
  elements: ConversationBridgeControlElement[]
): ConversationBridgeControlBlock {
  return { type: 'actions', elements }
}

function supportsChatSurface(runtime: ReturnType<typeof listRuntimeCatalog>[number]): boolean {
  return runtime.surfaces?.includes('chat') ?? true
}

function listSessionTargets(): SessionTargetSummary[] {
  const runtimes = listRuntimeCatalog().filter(
    (runtime) =>
      supportsChatSurface(runtime) &&
      runtime.providerKinds.length > 0
  )
  const runtimeLabels = new Map(runtimes.map((runtime) => [runtime.runtimeKind, runtime.label]))
  const agentTargets = Agents.list({ enabled: true })
    .filter((agent) => Boolean(agent.providerTargetId))
    .map((agent) => ({
      kind: 'agent' as const,
      id: agent.id,
      label: agent.name,
      description: agent.description,
      runtimeKind: agent.runtimeKind,
      runtimeLabel: runtimeLabels.get(agent.runtimeKind) ?? null,
      providerTargetId: agent.providerTargetId,
      modelId: agent.modelId
    }))

  const providerRuntimeTargets = ProviderTargets.listStoredProviderTargets()
    .filter((target) => target.enabled)
    .flatMap((target) =>
      runtimes
        .filter((runtime) => runtime.providerKinds.includes(target.providerKind))
        .map((runtime) => ({
          kind: 'provider-target' as const,
          id: target.id,
          label: target.displayName,
          description: target.providerKind,
          runtimeKind: runtime.runtimeKind,
          runtimeLabel: runtime.label,
          providerTargetId: target.id,
          modelId: null
        }))
    )

  return [...agentTargets, ...providerRuntimeTargets]
}

function listProviderTargetModels(providerTargetId: string): ProviderModelSummary[] {
  const target = ProviderTargets.getProviderTarget(providerTargetId)
  if (!target) {
    return []
  }
  const cached = getCachedModelsForTarget({ id: target.id, kind: target.kind })
  return (cached?.models ?? []).map((model) => ({
    id: model.id,
    label: model.label
  }))
}

function sessionTargetValue(
  target: Pick<SessionTargetSummary, 'kind' | 'id' | 'runtimeKind'>
): string {
  if (target.kind === 'provider-target') {
    return `${target.kind}:${target.runtimeKind ?? 'standard'}:${target.id}`
  }
  return `${target.kind}:${target.id}`
}

function parseSessionTargetValue(value: string): {
  kind: SessionTargetSummary['kind']
  id: string
  runtimeKind: string | null
} | null {
  if (value.startsWith('agent:')) {
    const id = value.slice('agent:'.length)
    return id ? { kind: 'agent', id, runtimeKind: null } : null
  }

  if (!value.startsWith('provider-target:')) {
    return null
  }

  const remainder = value.slice('provider-target:'.length)
  const separatorIndex = remainder.indexOf(':')
  const runtimeKind = separatorIndex > 0 ? remainder.slice(0, separatorIndex) : ''
  const id = remainder.slice(separatorIndex + 1)
  if (!runtimeKind || !id) {
    return null
  }

  return { kind: 'provider-target', id, runtimeKind }
}

function sessionModelValue(modelId: string | null): string {
  return modelId ?? DEFAULT_MODEL_VALUE
}

function parseSessionModelValue(value: string): string | null {
  return value === DEFAULT_MODEL_VALUE ? null : value
}

function selectedTargetForBinding(
  binding: ConversationBridgeChannelBindingView | null,
  targets: SessionTargetSummary[]
): SessionTargetSummary | null {
  if (!binding) {
    return null
  }
  if (binding.sessionAgentId) {
    return (
      targets.find((target) => target.kind === 'agent' && target.id === binding.sessionAgentId) ??
      null
    )
  }
  if (binding.sessionProviderTargetId) {
    const runtimeKind = binding.sessionRuntimeKind ?? 'standard'
    return (
      targets.find(
        (target) =>
          target.kind === 'provider-target' &&
          target.id === binding.sessionProviderTargetId &&
          (target.runtimeKind ?? 'standard') === runtimeKind
      ) ?? null
    )
  }
  return null
}

function runtimeLabelForTarget(target: SessionTargetSummary): string {
  if (target.runtimeLabel) {
    return target.runtimeLabel
  }
  return target.runtimeKind ?? 'Runtime'
}

function sessionTargetLabel(target: SessionTargetSummary): string {
  return target.kind === 'agent'
    ? `Agent: ${target.label}`
    : `${runtimeLabelForTarget(target)}: ${target.label}`
}

function sessionTargetDescription(target: SessionTargetSummary): string {
  if (target.kind === 'agent') {
    return (
      [target.runtimeKind, target.modelId].filter(Boolean).join(' - ') || 'Agent default runtime'
    )
  }
  return target.description ?? 'Provider target'
}

function sessionTargetOption(target: SessionTargetSummary): ConversationBridgeControlOption {
  return {
    label: truncatePresentationText(sessionTargetLabel(target), 75),
    description: truncatePresentationText(sessionTargetDescription(target), 75),
    value: sessionTargetValue(target)
  }
}

function sessionModelOption(model: ProviderModelSummary | null): ConversationBridgeControlOption {
  if (!model) {
    return {
      label: 'Use default model',
      description: 'Let the selected agent or provider choose',
      value: DEFAULT_MODEL_VALUE
    }
  }
  return {
    label: truncatePresentationText(model.label || model.id, 75),
    description: truncatePresentationText(model.id, 75),
    value: sessionModelValue(model.id)
  }
}

function workspaceOption(workspace: WorkspaceSummary): ConversationBridgeControlOption {
  return {
    label: truncatePresentationText(workspace.name || workspace.id, 75),
    description: truncatePresentationText(workspace.locator.path || workspace.id, 75),
    value: workspace.id
  }
}

function buildWorkspaceSelectBlocks(input: {
  binding: ConversationBridgeChannelBindingView | null
  prompt: string
  workspaces: WorkspaceSummary[]
}): ConversationBridgeControlBlock[] {
  const options = input.workspaces.slice(0, CONTROL_OPTION_LIMIT).map(workspaceOption)
  if (!options.length) {
    return [
      sectionBlock(
        `${input.prompt}\n\nNo Cradle workspaces are available. Create or import a workspace in Cradle first.`
      )
    ]
  }

  const selectedWorkspace = input.binding
    ? (input.workspaces.find((workspace) => workspace.id === input.binding?.cradleWorkspaceId) ??
      null)
    : null
  const blocks: ConversationBridgeControlBlock[] = [
    sectionBlock(input.prompt),
    actionsBlock([
      {
        type: 'static_select',
        actionId: CONVERSATION_BRIDGE_WORKSPACE_SELECT_ACTION,
        placeholder: 'Choose Cradle workspace',
        options,
        ...(selectedWorkspace ? { initialOption: workspaceOption(selectedWorkspace) } : {})
      }
    ])
  ]
  if (input.workspaces.length > CONTROL_OPTION_LIMIT) {
    blocks.push(
      contextBlock(
        `Showing the first ${CONTROL_OPTION_LIMIT} workspaces. Use \`/cradle bind workspace <workspace-id>\` for workspaces not shown here.`
      )
    )
  }
  return blocks
}

function buildSessionModelSelectBlocks(input: {
  binding: ConversationBridgeChannelBindingView | null
  models: ProviderModelSummary[]
  prompt: string
}): ConversationBridgeControlBlock[] {
  const options = [
    sessionModelOption(null),
    ...input.models.slice(0, CONTROL_OPTION_LIMIT - 1).map(sessionModelOption)
  ]
  const selectedModel = input.binding?.sessionModelId
    ? (input.models.find((model) => model.id === input.binding?.sessionModelId) ?? null)
    : null
  const initialOption = selectedModel ? sessionModelOption(selectedModel) : sessionModelOption(null)
  return [
    sectionBlock(
      input.models.length
        ? input.prompt
        : `${input.prompt}\n\nNo cached models are available for the selected runtime yet.`
    ),
    actionsBlock([
      {
        type: 'static_select',
        actionId: CONVERSATION_BRIDGE_SESSION_MODEL_SELECT_ACTION,
        placeholder: 'Choose model',
        options,
        initialOption
      }
    ])
  ]
}

function buildSessionTargetSelectBlocks(input: {
  binding: ConversationBridgeChannelBindingView | null
  targets: SessionTargetSummary[]
  models?: ProviderModelSummary[]
  prompt: string
}): ConversationBridgeControlBlock[] {
  const options = input.targets.slice(0, CONTROL_OPTION_LIMIT).map(sessionTargetOption)
  if (!options.length) {
    return [
      sectionBlock(`${input.prompt}\n\nNo enabled Cradle agents or provider targets are available.`)
    ]
  }

  const selected = selectedTargetForBinding(input.binding, input.targets)
  const blocks: ConversationBridgeControlBlock[] = [
    sectionBlock(input.prompt),
    actionsBlock([
      {
        type: 'static_select',
        actionId: CONVERSATION_BRIDGE_SESSION_TARGET_SELECT_ACTION,
        placeholder: 'Choose Cradle runtime',
        options,
        ...(selected ? { initialOption: sessionTargetOption(selected) } : {})
      }
    ])
  ]
  if (selected) {
    blocks.push(
      ...buildSessionModelSelectBlocks({
        binding: input.binding,
        models: input.models ?? [],
        prompt: '*Default model for new external threads*'
      })
    )
  }
  return blocks
}

function describeSessionTarget(
  binding: ConversationBridgeChannelBindingView | null,
  targets: SessionTargetSummary[]
): string {
  const selected = selectedTargetForBinding(binding, targets)
  if (selected) {
    return escapePresentationText(sessionTargetLabel(selected))
  }
  if (binding?.sessionAgentId) {
    return `Agent: \`${escapePresentationText(binding.sessionAgentId)}\``
  }
  if (binding?.sessionProviderTargetId) {
    return `${escapePresentationText(binding.sessionRuntimeKind ?? 'standard')}: \`${escapePresentationText(binding.sessionProviderTargetId)}\``
  }
  return 'Not selected'
}

function describeSessionModel(
  binding: ConversationBridgeChannelBindingView | null,
  models: ProviderModelSummary[]
): string {
  if (!binding?.sessionModelId) {
    return 'Default'
  }
  const model = models.find((candidate) => candidate.id === binding.sessionModelId)
  return escapePresentationText(model?.label || binding.sessionModelId)
}

function listRecentThreadBindingsForChannel(input: {
  connectionId: string
  externalWorkspaceId: string
  externalChannelId: string
  limit: number
}): ConversationBridgeThreadBindingView[] {
  return db()
    .select()
    .from(conversationBridgeThreadBindings)
    .where(
      and(
        eq(conversationBridgeThreadBindings.connectionId, input.connectionId),
        eq(conversationBridgeThreadBindings.externalWorkspaceId, input.externalWorkspaceId),
        eq(conversationBridgeThreadBindings.externalChannelId, input.externalChannelId)
      )
    )
    .orderBy(desc(conversationBridgeThreadBindings.updatedAt))
    .limit(input.limit)
    .all()
    .map(toThreadBindingView)
}

function resolveStatusConversations(
  threads: ConversationBridgeThreadBindingView[]
): StatusConversation[] {
  return threads.map((thread) => ({
    externalThreadId: thread.externalThreadId,
    sessionId: thread.sessionId,
    sessionTitle: Session.get(thread.sessionId)?.title ?? null
  }))
}

function listModelsForBinding(
  binding: ConversationBridgeChannelBindingView | null,
  targets: SessionTargetSummary[]
): ProviderModelSummary[] {
  const selected = selectedTargetForBinding(binding, targets)
  return selected?.providerTargetId ? listProviderTargetModels(selected.providerTargetId) : []
}

function buildStatusResponse(input: {
  connectionId: string
  externalWorkspaceId: string
  externalChannelId: string
  binding: ConversationBridgeChannelBindingView | null
  conversations: StatusConversation[]
  sessionTargets: SessionTargetSummary[]
  models: ProviderModelSummary[]
  replaceOriginal?: boolean
}): ConversationBridgeControlResponse {
  const bindingText = input.binding
    ? `This external channel is connected to Cradle workspace ${input.binding.cradleWorkspaceId}.`
    : 'This external channel is not connected to a Cradle workspace.'
  const threadText = input.conversations.length
    ? input.conversations
        .map(
          (conversation) =>
            `- ${conversation.sessionTitle ?? 'Untitled Cradle session'} started from an external conversation on ${dateFromExternalThreadId(conversation.externalThreadId)}.`
        )
        .join('\n')
    : 'No external conversations have been connected to Cradle yet.'
  const sessionTargetText = describeSessionTarget(input.binding, input.sessionTargets)
  const sessionModelText = describeSessionModel(input.binding, input.models)
  const blocks: ConversationBridgeControlBlock[] = [
    headerBlock('Cradle Conversation Bridge'),
    sectionBlock(
      input.binding
        ? `*Connected.* New external threads in this channel can create Cradle sessions in *${escapePresentationText(input.binding.cradleWorkspaceId)}*. Replies in already-connected threads continue the matching Cradle session.`
        : '*Not connected yet.* Bind this channel to a Cradle workspace before starting new Cradle-backed conversations.'
    ),
    contextBlock(
      input.binding
        ? `Workspace: \`${escapePresentationText(input.binding.cradleWorkspaceId)}\` | Runtime: ${sessionTargetText} | Model: ${sessionModelText}`
        : 'Run `/cradle bind workspace` to choose a workspace for this channel.'
    ),
    dividerBlock()
  ]

  if (input.conversations.length) {
    blocks.push(sectionBlock('*Recent connected conversations*'))
    for (const conversation of input.conversations) {
      const title = conversation.sessionTitle?.trim() || 'Untitled Cradle session'
      blocks.push(
        sectionBlock(
          `*${escapePresentationText(title)}*\nStarted from an external conversation on ${dateFromExternalThreadId(conversation.externalThreadId)}.`,
          {
            type: 'button',
            text: 'View details',
            actionId: CONVERSATION_BRIDGE_STATUS_REFRESH_ACTION,
            value: conversation.sessionId
          }
        )
      )
      blocks.push(
        contextBlock(
          `External thread \`${escapePresentationText(conversation.externalThreadId)}\` · Cradle session \`${escapePresentationText(shortId(conversation.sessionId))}\``
        )
      )
    }
  } else {
    blocks.push(
      sectionBlock(
        'No external conversations have been connected to Cradle yet. Mention the adapter in this channel to start the first one after the channel is bound.'
      )
    )
  }

  if (input.binding) {
    blocks.push(dividerBlock())
    blocks.push(
      ...buildSessionTargetSelectBlocks({
        binding: input.binding,
        targets: input.sessionTargets,
        models: input.models,
        prompt: '*Default runtime for new external threads*'
      })
    )
  } else {
    blocks.push(dividerBlock())
    blocks.push(
      ...buildWorkspaceSelectBlocks({
        binding: input.binding,
        workspaces: Workspace.list(),
        prompt: '*Workspace for new external threads*'
      })
    )
  }

  blocks.push(
    dividerBlock(),
    actionsBlock([
      {
        type: 'button',
        text: 'Refresh status',
        actionId: CONVERSATION_BRIDGE_STATUS_REFRESH_ACTION,
        value: input.externalChannelId
      },
      ...(input.binding
        ? [
            {
              type: 'button' as const,
              text: 'Disconnect channel',
              actionId: CONVERSATION_BRIDGE_CHANNEL_UNBIND_ACTION,
              value: input.externalChannelId,
              style: 'danger' as const,
              confirm: {
                title: 'Disconnect channel?',
                text: 'New external threads in this channel will stop creating Cradle sessions until the channel is connected again.',
                confirm: 'Disconnect',
                deny: 'Cancel'
              }
            }
          ]
        : [])
    ])
  )

  return {
    text: `${bindingText}\nDefault runtime: ${sessionTargetText}\nDefault model: ${sessionModelText}\n\nRecent connected conversations:\n${threadText}`,
    blocks,
    visibility: 'ephemeral',
    replaceOriginal: input.replaceOriginal
  }
}

function statusResponseForChannel(input: {
  connectionId: string
  externalWorkspaceId: string
  externalChannelId: string
  replaceOriginal?: boolean
}): ConversationBridgeControlResponse {
  const binding = getChannelBinding(
    input.connectionId,
    input.externalWorkspaceId,
    input.externalChannelId
  )
  const threads = listRecentThreadBindingsForChannel({
    connectionId: input.connectionId,
    externalWorkspaceId: input.externalWorkspaceId,
    externalChannelId: input.externalChannelId,
    limit: 5
  })
  const sessionTargets = listSessionTargets()
  const models = listModelsForBinding(binding, sessionTargets)
  return buildStatusResponse({
    ...input,
    binding,
    conversations: resolveStatusConversations(threads),
    sessionTargets,
    models
  })
}

export function listAdapters(): ConversationBridgeAdapterView[] {
  return listConversationBridgeAdapters().map((registered) => ({
    key: registered.key,
    owner: registered.owner,
    id: registered.adapter.id,
    platform: registered.adapter.platform,
    label: registered.adapter.label,
    description: registered.adapter.description ?? null,
    capabilities: { ...(registered.adapter.capabilities ?? {}) },
    registeredAt: registered.registeredAt
  }))
}

export function listConnections(): ConversationBridgeConnectionView[] {
  return db().select().from(conversationBridgeConnections).all().map(toConnectionView)
}

export function getConnection(id: string): ConversationBridgeConnectionView | null {
  const row = db()
    .select()
    .from(conversationBridgeConnections)
    .where(eq(conversationBridgeConnections.id, id))
    .get()
  return row ? toConnectionView(row) : null
}

export function createConnection(input: CreateConnectionInput): ConversationBridgeConnectionView {
  const timestamp = now()
  const row = db()
    .insert(conversationBridgeConnections)
    .values({
      id: randomUUID(),
      platform: input.platform.trim(),
      adapterOwner: input.adapterOwner.trim(),
      adapterId: input.adapterId.trim(),
      displayName: input.displayName.trim(),
      enabled: input.enabled ?? true,
      secretRefsJson: stringifyRecord(input.secretRefs),
      configJson: stringifyRecord(input.config),
      createdAt: timestamp,
      updatedAt: timestamp
    })
    .returning()
    .get()
  return toConnectionView(row)
}

export function updateConnection(
  input: UpdateConnectionInput
): ConversationBridgeConnectionView | null {
  const existing = db()
    .select()
    .from(conversationBridgeConnections)
    .where(eq(conversationBridgeConnections.id, input.id))
    .get()
  if (!existing) {
    return null
  }
  const row = db()
    .update(conversationBridgeConnections)
    .set({
      displayName: input.displayName?.trim() ?? existing.displayName,
      enabled: input.enabled ?? existing.enabled,
      secretRefsJson:
        input.secretRefs === undefined
          ? existing.secretRefsJson
          : stringifyRecord(input.secretRefs),
      configJson: input.config === undefined ? existing.configJson : stringifyRecord(input.config),
      updatedAt: now()
    })
    .where(eq(conversationBridgeConnections.id, input.id))
    .returning()
    .get()
  return toConnectionView(row)
}

export function deleteConnection(id: string): void {
  db().delete(conversationBridgeConnections).where(eq(conversationBridgeConnections.id, id)).run()
}

export function bindChannel(input: BindChannelInput): ConversationBridgeChannelBindingView {
  const existing = getChannelBinding(
    input.connectionId,
    input.externalWorkspaceId,
    input.externalChannelId
  )
  const timestamp = now()
  const id = existing?.id ?? randomUUID()
  db()
    .insert(conversationBridgeChannelBindings)
    .values({
      id,
      connectionId: input.connectionId,
      externalWorkspaceId: input.externalWorkspaceId,
      externalChannelId: input.externalChannelId,
      cradleWorkspaceId: input.cradleWorkspaceId,
      sessionAgentId: input.sessionAgentId ?? null,
      sessionProviderTargetId: input.sessionProviderTargetId ?? null,
      sessionRuntimeKind: input.sessionRuntimeKind ?? null,
      sessionModelId: input.sessionModelId ?? null,
      boundByExternalActorId: input.boundByExternalActorId ?? null,
      metadataJson: stringifyRecord(input.metadata),
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    })
    .onConflictDoUpdate({
      target: [
        conversationBridgeChannelBindings.connectionId,
        conversationBridgeChannelBindings.externalWorkspaceId,
        conversationBridgeChannelBindings.externalChannelId
      ],
      set: {
        cradleWorkspaceId: input.cradleWorkspaceId,
        sessionAgentId: input.sessionAgentId ?? null,
        sessionProviderTargetId: input.sessionProviderTargetId ?? null,
        sessionRuntimeKind: input.sessionRuntimeKind ?? null,
        sessionModelId: input.sessionModelId ?? null,
        boundByExternalActorId: input.boundByExternalActorId ?? null,
        metadataJson: stringifyRecord(input.metadata),
        updatedAt: timestamp
      }
    })
    .run()
  const row = db()
    .select()
    .from(conversationBridgeChannelBindings)
    .where(eq(conversationBridgeChannelBindings.id, id))
    .get()
  if (!row) {
    throw new AppError({
      code: 'conversation_bridge_binding_failed',
      status: 500,
      message: 'Channel binding was not persisted'
    })
  }
  return toChannelBindingView(row)
}

export function listChannelBindings(connectionId: string): ConversationBridgeChannelBindingView[] {
  return db()
    .select()
    .from(conversationBridgeChannelBindings)
    .where(eq(conversationBridgeChannelBindings.connectionId, connectionId))
    .orderBy(desc(conversationBridgeChannelBindings.updatedAt))
    .all()
    .map(toChannelBindingView)
}

export function getChannelBinding(
  connectionId: string,
  externalWorkspaceId: string,
  externalChannelId: string
): ConversationBridgeChannelBindingView | null {
  const row = db()
    .select()
    .from(conversationBridgeChannelBindings)
    .where(
      and(
        eq(conversationBridgeChannelBindings.connectionId, connectionId),
        eq(conversationBridgeChannelBindings.externalWorkspaceId, externalWorkspaceId),
        eq(conversationBridgeChannelBindings.externalChannelId, externalChannelId)
      )
    )
    .get()
  return row ? toChannelBindingView(row) : null
}

export function unbindChannel(
  connectionId: string,
  externalWorkspaceId: string,
  externalChannelId: string
): void {
  db()
    .delete(conversationBridgeChannelBindings)
    .where(
      and(
        eq(conversationBridgeChannelBindings.connectionId, connectionId),
        eq(conversationBridgeChannelBindings.externalWorkspaceId, externalWorkspaceId),
        eq(conversationBridgeChannelBindings.externalChannelId, externalChannelId)
      )
    )
    .run()
}

function ephemeralControlResponse(
  text: string,
  replaceOriginal?: boolean
): ConversationBridgeControlResponse {
  return {
    text,
    visibility: 'ephemeral',
    replaceOriginal
  }
}

function bindExistingChannelWithDefaults(input: {
  binding: ConversationBridgeChannelBindingView
  sessionAgentId?: string | null
  sessionProviderTargetId?: string | null
  sessionRuntimeKind?: string | null
  sessionModelId?: string | null
  actorId?: string | null
}): ConversationBridgeChannelBindingView {
  return bindChannel({
    connectionId: input.binding.connectionId,
    externalWorkspaceId: input.binding.externalWorkspaceId,
    externalChannelId: input.binding.externalChannelId,
    cradleWorkspaceId: input.binding.cradleWorkspaceId,
    sessionAgentId: input.sessionAgentId,
    sessionProviderTargetId: input.sessionProviderTargetId,
    sessionRuntimeKind: input.sessionRuntimeKind,
    sessionModelId: input.sessionModelId,
    boundByExternalActorId: input.actorId ?? input.binding.boundByExternalActorId,
    metadata: input.binding.metadata
  })
}

function bindWorkspaceForControl(input: {
  control: NormalizedConversationControl
  workspace: WorkspaceSummary
}): ConversationBridgeChannelBindingView {
  const existing = getChannelBinding(
    input.control.connectionId,
    input.control.externalWorkspaceId,
    input.control.externalChannelId
  )
  return bindChannel({
    connectionId: input.control.connectionId,
    externalWorkspaceId: input.control.externalWorkspaceId,
    externalChannelId: input.control.externalChannelId,
    cradleWorkspaceId: input.workspace.id,
    sessionAgentId: existing?.sessionAgentId ?? null,
    sessionProviderTargetId: existing?.sessionProviderTargetId ?? null,
    sessionRuntimeKind: existing?.sessionRuntimeKind ?? null,
    sessionModelId: existing?.sessionModelId ?? null,
    boundByExternalActorId:
      input.control.externalActorId ?? existing?.boundByExternalActorId ?? null,
    metadata: existing?.metadata ?? { source: 'conversation-bridge-control' }
  })
}

function bindWorkspaceResponse(input: {
  control: NormalizedConversationControl
  workspace: WorkspaceSummary
  visibility: ConversationBridgeControlResponse['visibility']
  replaceOriginal?: boolean
}): ConversationBridgeControlResponse {
  const binding = bindWorkspaceForControl({
    control: input.control,
    workspace: input.workspace
  })
  const sessionTargets = listSessionTargets()
  const models = listModelsForBinding(binding, sessionTargets)
  return {
    text: `Bound this external channel to Cradle workspace ${input.workspace.id}. Choose the default Cradle runtime for new external threads.`,
    blocks: buildSessionTargetSelectBlocks({
      binding,
      targets: sessionTargets,
      models,
      prompt: `Bound this external channel to Cradle workspace \`${escapePresentationText(input.workspace.id)}\`. Choose the default Cradle runtime for new external threads.`
    }),
    visibility: input.visibility,
    replaceOriginal: input.replaceOriginal
  }
}

function workspaceSelectResponse(
  input: NormalizedConversationControl,
  replaceOriginal?: boolean
): ConversationBridgeControlResponse {
  const binding = getChannelBinding(
    input.connectionId,
    input.externalWorkspaceId,
    input.externalChannelId
  )
  return {
    text: 'Choose a Cradle workspace for this external channel.',
    blocks: buildWorkspaceSelectBlocks({
      binding,
      workspaces: Workspace.list(),
      prompt: '*Choose a Cradle workspace for this external channel*'
    }),
    visibility: 'ephemeral',
    replaceOriginal
  }
}

async function handleCommandControl(
  input: NormalizedConversationControl
): Promise<ConversationBridgeControlResponse> {
  const [action, subject, value] = parseControlCommand(input.text)

  if (action === 'bind' && subject === 'workspace') {
    if (!value) {
      return workspaceSelectResponse(input)
    }
    const workspace = Workspace.get(value)
    if (!workspace) {
      return ephemeralControlResponse(`Workspace ${value} was not found in Cradle.`)
    }
    return bindWorkspaceResponse({
      control: input,
      workspace,
      visibility: 'in_channel'
    })
  }

  if (action === 'unbind') {
    unbindChannel(input.connectionId, input.externalWorkspaceId, input.externalChannelId)
    return {
      text: 'Removed the Cradle workspace binding for this channel.',
      visibility: 'in_channel'
    }
  }

  if (action === 'status' || !action) {
    return statusResponseForChannel(input)
  }

  return ephemeralControlResponse(
    'Usage: /cradle bind workspace, /cradle bind workspace <workspace-id>, /cradle unbind, or /cradle status'
  )
}

async function handleWorkspaceSelectControl(
  input: NormalizedConversationControl
): Promise<ConversationBridgeControlResponse> {
  if (!input.selectedValue) {
    return ephemeralControlResponse('Selected Cradle workspace was invalid.')
  }
  const workspace = Workspace.get(input.selectedValue)
  if (!workspace) {
    return ephemeralControlResponse('Selected Cradle workspace is no longer available.')
  }
  return bindWorkspaceResponse({
    control: input,
    workspace,
    visibility: 'ephemeral',
    replaceOriginal: true
  })
}

async function handleSessionTargetSelectControl(
  input: NormalizedConversationControl
): Promise<ConversationBridgeControlResponse> {
  const parsed = input.selectedValue ? parseSessionTargetValue(input.selectedValue) : null
  if (!parsed) {
    return ephemeralControlResponse('Selected Cradle runtime was invalid.')
  }

  const binding = getChannelBinding(
    input.connectionId,
    input.externalWorkspaceId,
    input.externalChannelId
  )
  if (!binding) {
    return ephemeralControlResponse(
      'Bind this channel to a Cradle workspace before choosing a runtime.'
    )
  }

  const sessionTargets = listSessionTargets()
  const target = sessionTargets.find(
    (candidate) =>
      candidate.kind === parsed.kind &&
      candidate.id === parsed.id &&
      (candidate.kind === 'agent' || (candidate.runtimeKind ?? 'standard') === parsed.runtimeKind)
  )
  if (!target) {
    return ephemeralControlResponse('Selected Cradle runtime is no longer available.')
  }

  bindExistingChannelWithDefaults({
    binding,
    sessionAgentId: target.kind === 'agent' ? target.id : null,
    sessionProviderTargetId: target.kind === 'provider-target' ? target.id : null,
    sessionRuntimeKind:
      target.kind === 'provider-target' ? (target.runtimeKind ?? 'standard') : null,
    sessionModelId: null,
    actorId: input.externalActorId
  })
  return statusResponseForChannel({ ...input, replaceOriginal: true })
}

async function handleSessionModelSelectControl(
  input: NormalizedConversationControl
): Promise<ConversationBridgeControlResponse> {
  if (!input.selectedValue) {
    return ephemeralControlResponse('Selected Cradle model was invalid.')
  }
  const binding = getChannelBinding(
    input.connectionId,
    input.externalWorkspaceId,
    input.externalChannelId
  )
  if (!binding) {
    return ephemeralControlResponse(
      'Bind this channel to a Cradle workspace before choosing a model.'
    )
  }

  const sessionTargets = listSessionTargets()
  const selectedTarget = selectedTargetForBinding(binding, sessionTargets)
  if (!selectedTarget?.providerTargetId) {
    return ephemeralControlResponse('Choose a Cradle runtime before choosing a model.')
  }

  const modelId = parseSessionModelValue(input.selectedValue)
  if (modelId) {
    const models = listProviderTargetModels(selectedTarget.providerTargetId)
    if (!models.some((model) => model.id === modelId)) {
      return ephemeralControlResponse('Selected Cradle model is no longer available.')
    }
  }

  bindExistingChannelWithDefaults({
    binding,
    sessionAgentId: binding.sessionAgentId,
    sessionProviderTargetId: binding.sessionProviderTargetId,
    sessionRuntimeKind: binding.sessionRuntimeKind,
    sessionModelId: modelId,
    actorId: input.externalActorId
  })
  return statusResponseForChannel({ ...input, replaceOriginal: true })
}

async function handleActionControl(
  input: NormalizedConversationControl
): Promise<ConversationBridgeControlResponse> {
  switch (input.actionId) {
    case CONVERSATION_BRIDGE_STATUS_REFRESH_ACTION:
      return statusResponseForChannel({ ...input, replaceOriginal: true })
    case CONVERSATION_BRIDGE_CHANNEL_UNBIND_ACTION:
      unbindChannel(input.connectionId, input.externalWorkspaceId, input.externalChannelId)
      return statusResponseForChannel({ ...input, replaceOriginal: true })
    case CONVERSATION_BRIDGE_WORKSPACE_SELECT_ACTION:
      return await handleWorkspaceSelectControl(input)
    case CONVERSATION_BRIDGE_SESSION_TARGET_SELECT_ACTION:
      return await handleSessionTargetSelectControl(input)
    case CONVERSATION_BRIDGE_SESSION_MODEL_SELECT_ACTION:
      return await handleSessionModelSelectControl(input)
    default:
      return ephemeralControlResponse('Selected Cradle action was invalid.')
  }
}

export async function handleControl(
  input: NormalizedConversationControl
): Promise<ConversationBridgeControlResponse> {
  if (!getConnection(input.connectionId)) {
    return ephemeralControlResponse('Conversation bridge connection was not found.')
  }
  if (input.kind === 'command') {
    return await handleCommandControl(input)
  }
  return await handleActionControl(input)
}

export function listRecentThreadBindings(
  connectionId: string,
  limit = 10
): ConversationBridgeThreadBindingView[] {
  return db()
    .select()
    .from(conversationBridgeThreadBindings)
    .where(eq(conversationBridgeThreadBindings.connectionId, connectionId))
    .orderBy(desc(conversationBridgeThreadBindings.updatedAt))
    .limit(limit)
    .all()
    .map(toThreadBindingView)
}

function getThreadBinding(
  event: NormalizedConversationInboundMessage
): ConversationBridgeThreadBindingView | null {
  const row = db()
    .select()
    .from(conversationBridgeThreadBindings)
    .where(
      and(
        eq(conversationBridgeThreadBindings.connectionId, event.connectionId),
        eq(conversationBridgeThreadBindings.externalWorkspaceId, event.externalWorkspaceId),
        eq(conversationBridgeThreadBindings.externalChannelId, event.externalChannelId),
        eq(conversationBridgeThreadBindings.externalThreadId, event.externalThreadId)
      )
    )
    .get()
  return row ? toThreadBindingView(row) : null
}

function createThreadBinding(
  event: NormalizedConversationInboundMessage,
  sessionId: string,
  cradleWorkspaceId: string | null
): ConversationBridgeThreadBindingView {
  const timestamp = now()
  const row = db()
    .insert(conversationBridgeThreadBindings)
    .values({
      id: randomUUID(),
      connectionId: event.connectionId,
      externalWorkspaceId: event.externalWorkspaceId,
      externalChannelId: event.externalChannelId,
      externalThreadId: event.externalThreadId,
      sessionId,
      cradleWorkspaceId,
      createdByExternalActorId: event.externalActorId,
      metadataJson: stringifyRecord({ source: 'conversation-bridge' }),
      createdAt: timestamp,
      updatedAt: timestamp
    })
    .returning()
    .get()
  return toThreadBindingView(row)
}

function recordInboundEvent(event: NormalizedConversationInboundMessage): 'created' | 'duplicate' {
  const existing = db()
    .select({ id: conversationBridgeInboundEvents.id })
    .from(conversationBridgeInboundEvents)
    .where(
      and(
        eq(conversationBridgeInboundEvents.connectionId, event.connectionId),
        eq(conversationBridgeInboundEvents.externalEventId, event.externalEventId)
      )
    )
    .get()
  if (existing) {
    return 'duplicate'
  }
  db()
    .insert(conversationBridgeInboundEvents)
    .values({
      id: randomUUID(),
      connectionId: event.connectionId,
      externalEventId: event.externalEventId,
      externalWorkspaceId: event.externalWorkspaceId,
      externalChannelId: event.externalChannelId,
      externalThreadId: event.externalThreadId,
      externalMessageId: event.externalMessageId,
      eventType: event.eventType,
      status: 'received',
      payloadJson: stringifyRecord(event.payload),
      receivedAt: now()
    })
    .run()
  return 'created'
}

function markInboundEvent(
  event: NormalizedConversationInboundMessage,
  status: 'processed' | 'ignored' | 'failed',
  reason: string | null
): void {
  db()
    .update(conversationBridgeInboundEvents)
    .set({
      status,
      reason,
      processedAt: now()
    })
    .where(
      and(
        eq(conversationBridgeInboundEvents.connectionId, event.connectionId),
        eq(conversationBridgeInboundEvents.externalEventId, event.externalEventId)
      )
    )
    .run()
}

function readAssistantText(messageId: string): string {
  const row = db().select().from(messages).where(eq(messages.id, messageId)).get()
  if (!row) {
    return ''
  }
  return extractMessageText(parseStoredMessageSnapshot(row.messageJson))
}

async function runSessionTurn(
  sessionId: string,
  text: string
): Promise<{
  runId: string
  assistantMessageId: string
  userMessageId: string
  text: string
}> {
  const response = await ChatRuntime.streamResponse({ sessionId, text })
  const reader = response.stream.getReader()
  void (async () => {
    try {
      while (!(await reader.read()).done) {}
    } finally {
      reader.releaseLock()
    }
  })()
  const run = await ChatRuntime.waitForRunCompletion(response.runId)
  if (run.status === 'failed') {
    throw new AppError({
      code: 'conversation_bridge_run_failed',
      status: 500,
      message: run.errorText ?? 'Conversation bridge chat run failed',
      details: { runId: run.id }
    })
  }
  return {
    runId: response.runId,
    assistantMessageId: response.assistantMessageId,
    userMessageId: response.userMessageId,
    text: readAssistantText(response.assistantMessageId)
  }
}

async function deliverResponse(input: {
  binding: ConversationBridgeThreadBindingView
  text: string
  runId: string
  assistantMessageId: string
}): Promise<void> {
  const timestamp = now()
  const attempt = db()
    .insert(conversationBridgeDeliveryAttempts)
    .values({
      id: randomUUID(),
      connectionId: input.binding.connectionId,
      externalWorkspaceId: input.binding.externalWorkspaceId,
      externalChannelId: input.binding.externalChannelId,
      externalThreadId: input.binding.externalThreadId,
      sessionId: input.binding.sessionId,
      cradleMessageId: input.assistantMessageId,
      runId: input.runId,
      payloadJson: stringifyRecord({ text: input.text }),
      status: 'pending',
      attemptCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp
    })
    .returning()
    .get()
  try {
    const delivered = await deliverBridgeMessage({
      connectionId: input.binding.connectionId,
      externalWorkspaceId: input.binding.externalWorkspaceId,
      externalChannelId: input.binding.externalChannelId,
      externalThreadId: input.binding.externalThreadId,
      text: input.text,
      payload: { text: input.text }
    })
    db()
      .update(conversationBridgeDeliveryAttempts)
      .set({
        status: 'delivered',
        attemptCount: attempt.attemptCount + 1,
        externalMessageId: delivered.externalMessageId,
        errorText: null,
        updatedAt: now()
      })
      .where(eq(conversationBridgeDeliveryAttempts.id, attempt.id))
      .run()
  } catch (error) {
    db()
      .update(conversationBridgeDeliveryAttempts)
      .set({
        status: 'failed',
        attemptCount: attempt.attemptCount + 1,
        errorText: error instanceof Error ? error.message : String(error),
        updatedAt: now()
      })
      .where(eq(conversationBridgeDeliveryAttempts.id, attempt.id))
      .run()
    throw error
  }
}

export async function handleInboundMessage(
  event: NormalizedConversationInboundMessage
): Promise<void> {
  if (recordInboundEvent(event) === 'duplicate') {
    return
  }
  try {
    let binding = getThreadBinding(event)
    if (!binding) {
      if (!event.mentionedAdapter) {
        markInboundEvent(
          event,
          'ignored',
          'message did not mention the adapter and thread is not bound'
        )
        return
      }
      const channelBinding = getChannelBinding(
        event.connectionId,
        event.externalWorkspaceId,
        event.externalChannelId
      )
      if (!channelBinding) {
        markInboundEvent(event, 'ignored', 'external channel is not bound to a Cradle workspace')
        return
      }
      if (!channelBinding.sessionAgentId && !channelBinding.sessionProviderTargetId) {
        markInboundEvent(event, 'ignored', 'external channel has no default Cradle runtime target')
        return
      }
      const session = Session.create({
        workspaceId: channelBinding.cradleWorkspaceId,
        title: titleFromText(event.text),
        origin: 'conversation-bridge',
        agentId: channelBinding.sessionAgentId,
        providerTargetId: channelBinding.sessionProviderTargetId ?? undefined,
        runtimeKind: channelBinding.sessionRuntimeKind ?? undefined,
        modelId: channelBinding.sessionModelId
      })
      binding = createThreadBinding(event, session.id, channelBinding.cradleWorkspaceId)
    }

    const response = await runSessionTurn(binding.sessionId, buildProvenanceText(event))
    await deliverResponse({
      binding,
      text: response.text,
      runId: response.runId,
      assistantMessageId: response.assistantMessageId
    })
    markInboundEvent(event, 'processed', null)
  } catch (error) {
    markInboundEvent(event, 'failed', error instanceof Error ? error.message : String(error))
    throw error
  }
}

export function listRetryableDeliveryAttempts(limit = 20): ConversationBridgeDeliveryAttemptView[] {
  return db()
    .select()
    .from(conversationBridgeDeliveryAttempts)
    .where(eq(conversationBridgeDeliveryAttempts.status, 'failed'))
    .orderBy(desc(conversationBridgeDeliveryAttempts.updatedAt))
    .limit(limit)
    .all()
    .filter((attempt) => attempt.attemptCount < 3)
    .map(toDeliveryAttemptView)
}

export async function retryFailedDeliveries(
  limit = 20
): Promise<{ attempted: number; delivered: number; failed: number }> {
  const attempts = listRetryableDeliveryAttempts(limit)
  let delivered = 0
  let failed = 0
  for (const attempt of attempts) {
    try {
      const result = await deliverBridgeMessage({
        connectionId: attempt.connectionId,
        externalWorkspaceId: attempt.externalWorkspaceId,
        externalChannelId: attempt.externalChannelId,
        externalThreadId: attempt.externalThreadId,
        text: typeof attempt.payload.text === 'string' ? attempt.payload.text : '',
        payload: attempt.payload
      })
      db()
        .update(conversationBridgeDeliveryAttempts)
        .set({
          status: 'delivered',
          attemptCount: attempt.attemptCount + 1,
          externalMessageId: result.externalMessageId,
          errorText: null,
          updatedAt: now()
        })
        .where(eq(conversationBridgeDeliveryAttempts.id, attempt.id))
        .run()
      delivered += 1
    } catch (error) {
      db()
        .update(conversationBridgeDeliveryAttempts)
        .set({
          status: 'failed',
          attemptCount: attempt.attemptCount + 1,
          errorText: error instanceof Error ? error.message : String(error),
          updatedAt: now()
        })
        .where(eq(conversationBridgeDeliveryAttempts.id, attempt.id))
        .run()
      failed += 1
    }
  }
  return { attempted: attempts.length, delivered, failed }
}

export function updateConnectionHealth(input: {
  connectionId: string
  status: 'starting' | 'running' | 'stopped' | 'error'
  message?: string | null
}): void {
  const timestamp = now()
  db()
    .update(conversationBridgeConnections)
    .set({
      healthStatus: input.status,
      healthMessage: input.message ?? null,
      lastStartedAt:
        input.status === 'starting' || input.status === 'running' ? timestamp : undefined,
      lastStoppedAt: input.status === 'stopped' ? timestamp : undefined,
      lastErrorAt: input.status === 'error' ? timestamp : undefined,
      updatedAt: timestamp
    })
    .where(eq(conversationBridgeConnections.id, input.connectionId))
    .run()
}
