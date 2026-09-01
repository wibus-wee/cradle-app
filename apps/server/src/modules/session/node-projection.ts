import { randomUUID } from 'node:crypto'

import { nodeSessionLinks, sessions } from '@cradle/db'
import { and, eq, inArray } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { currentUnixSeconds } from '../../helpers/time'
import {
  proxyUpstreamRequestByBaseUrl,
  upstreamFetchByBaseUrl,
  upstreamJsonByBaseUrl,
} from '../../http/upstream'
import { db } from '../../infra'
import type { ChatThinkingEffort } from '../chat-runtime/runtime-provider-types'
import type { ChatRuntimeSettingsUpdatePatch } from '../chat-runtime/runtime-settings-api'
import type { RuntimeKind } from '../provider-contracts/types'
import { getFabricNodeLinkManager } from '../relay-transport/node-link-manager'
import * as Workspace from '../workspace/service'
import type { WorkspaceLocator } from '../workspace/workspace-locator'
import { isLocalWorkspaceLocator } from '../workspace/workspace-locator'

export interface NodeSessionLinkView {
  localSessionId: string
  nodeId: string
  remoteSessionId: string
  remoteWorkspaceId: string
  projectionKind: 'controller-created' | 'discovered'
  createdAt: number
  updatedAt: number
}

export type SessionExecutionTarget
  = | { kind: 'local' }
    | { kind: 'node', nodeId: string, remoteSessionId: string }

export interface NodeSessionActivity {
  latestUserMessageAt: number | null
  latestAssistantMessageAt: number | null
}

export function getNodeSessionLink(localSessionId: string): NodeSessionLinkView | null {
  const row = db()
    .select()
    .from(nodeSessionLinks)
    .where(eq(nodeSessionLinks.localSessionId, localSessionId))
    .get()
  if (!row) {
    return null
  }
  return {
    localSessionId: row.localSessionId,
    nodeId: row.nodeId,
    remoteSessionId: row.remoteSessionId,
    remoteWorkspaceId: row.remoteWorkspaceId,
    projectionKind: row.projectionKind,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function isNodeProjectedSession(localSessionId: string): boolean {
  return getNodeSessionLink(localSessionId) !== null
}

export function requireNodeSessionLink(localSessionId: string): NodeSessionLinkView {
  const link = getNodeSessionLink(localSessionId)
  if (!link) {
    throw new AppError({
      code: 'node_session_link_not_found',
      status: 404,
      message: 'Node session link was not found for this local session projection.',
      details: { sessionId: localSessionId },
    })
  }
  return link
}

export function readSessionExecutionTarget(localSessionId: string): SessionExecutionTarget {
  const link = getNodeSessionLink(localSessionId)
  if (!link) {
    return { kind: 'local' }
  }
  return {
    kind: 'node',
    nodeId: link.nodeId,
    remoteSessionId: link.remoteSessionId,
  }
}

/** Read execution projections for a bounded Session page in one query. */
export function readSessionExecutionTargets(
  localSessionIds: readonly string[],
): Map<string, SessionExecutionTarget> {
  if (localSessionIds.length === 0) {
    return new Map()
  }
  const links = db()
    .select()
    .from(nodeSessionLinks)
    .where(inArray(nodeSessionLinks.localSessionId, [...localSessionIds]))
    .all()
  const linksBySessionId = new Map(links.map(link => [link.localSessionId, link]))
  return new Map(localSessionIds.map((sessionId) => {
    const link = linksBySessionId.get(sessionId)
    return [sessionId, link
      ? { kind: 'node', nodeId: link.nodeId, remoteSessionId: link.remoteSessionId }
      : { kind: 'local' }] as const
  }))
}

/** Read cached remote activity clocks for a bounded Session projection page. */
export function readNodeSessionActivities(
  localSessionIds: readonly string[],
): Map<string, NodeSessionActivity> {
  if (localSessionIds.length === 0) {
    return new Map()
  }
  const links = db()
    .select({
      localSessionId: nodeSessionLinks.localSessionId,
      latestUserMessageAt: nodeSessionLinks.latestUserMessageAt,
      latestAssistantMessageAt: nodeSessionLinks.latestAssistantMessageAt,
    })
    .from(nodeSessionLinks)
    .where(inArray(nodeSessionLinks.localSessionId, [...localSessionIds]))
    .all()
  return new Map(links.map(link => [link.localSessionId, {
    latestUserMessageAt: link.latestUserMessageAt,
    latestAssistantMessageAt: link.latestAssistantMessageAt,
  }]))
}

function readNodeWorkspaceLocator(workspaceId: string) {
  const workspace = Workspace.get(workspaceId)
  if (!workspace) {
    throw new AppError({
      code: 'workspace_not_found',
      status: 404,
      message: 'Workspace not found',
      details: { workspaceId },
    })
  }
  if (isLocalWorkspaceLocator(workspace.locator)) {
    return null
  }
  return workspace.locator
}

export async function resolveRemoteWorkspaceIdForLocator(
  locator: WorkspaceLocator,
): Promise<string> {
  if (locator.sourceWorkspaceId) {
    return locator.sourceWorkspaceId
  }
  const baseUrl = (await getFabricNodeLinkManager().ensure(locator.nodeId)).localBaseUrl
  const remoteWorkspace = await upstreamJsonByBaseUrl<{ id: string } | null>(baseUrl, `/workspaces/resolve?path=${encodeURIComponent(locator.path)}`)
  if (!remoteWorkspace) {
    throw new AppError({
      code: 'remote_cradle_workspace_not_resolved',
      status: 409,
      message: 'Remote workspace could not be resolved for session projection.',
      details: { nodeId: locator.nodeId, path: locator.path },
    })
  }
  return remoteWorkspace.id
}

interface NodeSessionCreateResponse {
  id: string
}

export interface ExistingNodeSessionProjectionInput {
  localSessionId?: string
  workspaceId: string
  nodeId: string
  remoteWorkspaceId: string
  sessionGroupId?: string | null
  remoteSession: {
    id: string
    title: string | null
    origin: string
    providerTargetId: string | null
    modelId: string | null
    thinkingEffort: ChatThinkingEffort | null
    runtimeKind: string
    linkedIssueId?: string | null
    archivedAt: number | null
    createdAt: number
    updatedAt: number
    latestUserMessageAt?: number | null
    latestAssistantMessageAt?: number | null
  }
  projectionKind: NodeSessionLinkView['projectionKind']
}

/** Attach a controller projection to a Session that already exists on a Node. */
export function attachExistingNodeSessionProjection(
  input: ExistingNodeSessionProjectionInput,
): { localSessionId: string } {
  const existing = db()
    .select({ localSessionId: nodeSessionLinks.localSessionId })
    .from(nodeSessionLinks)
    .where(and(
      eq(nodeSessionLinks.nodeId, input.nodeId),
      eq(nodeSessionLinks.remoteSessionId, input.remoteSession.id),
    ))
    .get()
  if (existing) {
    return existing
  }

  const localSessionId = input.localSessionId ?? randomUUID()
  const remote = input.remoteSession
  db().transaction((tx) => {
    tx.insert(sessions)
      .values({
        id: localSessionId,
        workspaceId: input.workspaceId,
        title: remote.title ?? 'Untitled',
        origin: remote.origin,
        providerTargetId: null,
        runtimeKind: remote.runtimeKind,
        agentId: null,
        configJson: projectionConfigJson(remote),
        linkedIssueId: remote.linkedIssueId ?? null,
        sessionGroupId: input.sessionGroupId ?? null,
        archivedAt: remote.archivedAt,
        createdAt: remote.createdAt,
        updatedAt: remote.updatedAt,
      })
      .run()

    tx.insert(nodeSessionLinks)
      .values({
        localSessionId,
        nodeId: input.nodeId,
        remoteSessionId: remote.id,
        remoteWorkspaceId: input.remoteWorkspaceId,
        projectionKind: input.projectionKind,
        latestUserMessageAt: remote.latestUserMessageAt ?? null,
        latestAssistantMessageAt: remote.latestAssistantMessageAt ?? null,
      })
      .run()
  })
  return { localSessionId }
}

export async function createNodeProjectedSession(input: {
  id?: string
  workspaceId: string
  title: string
  origin?: string
  providerTargetId?: string
  modelId?: string | null
  thinkingEffort?: ChatThinkingEffort | null
  runtimeKind?: RuntimeKind
  runtimeSettings?: ChatRuntimeSettingsUpdatePatch
  linkedIssueId?: string | null
  sessionGroupId?: string | null
}): Promise<{ localSessionId: string }> {
  const locator = readNodeWorkspaceLocator(input.workspaceId)
  if (!locator) {
    throw new AppError({
      code: 'node_session_link_required',
      status: 409,
      message: 'Session workspace is not mounted from a Fabric Node.',
      details: { workspaceId: input.workspaceId },
    })
  }

  const remoteWorkspaceId = await resolveRemoteWorkspaceIdForLocator(locator)
  const localSessionId = input.id ?? randomUUID()

  const baseUrl = (await getFabricNodeLinkManager().ensure(locator.nodeId)).localBaseUrl
  let remoteSession: NodeSessionCreateResponse
  try {
    remoteSession = await upstreamJsonByBaseUrl<NodeSessionCreateResponse>(baseUrl, '/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: input.title,
        workspaceId: remoteWorkspaceId,
        origin: input.origin ?? 'manual',
        providerTargetId: input.providerTargetId,
        modelId: input.modelId,
        thinkingEffort: input.thinkingEffort,
        runtimeKind: input.runtimeKind ?? 'standard',
        runtimeSettings: input.runtimeSettings,
        linkedIssueId: input.linkedIssueId ?? null,
        sessionGroupId: null,
      }),
    })
  }
  catch (error) {
    throw error instanceof AppError
      ? error
      : new AppError({
          code: 'remote_session_create_failed',
          status: 502,
          message: 'Remote Cradle Server session creation failed.',
          details: { nodeId: locator.nodeId },
        })
  }

  try {
    attachExistingNodeSessionProjection({
      localSessionId,
      workspaceId: input.workspaceId,
      nodeId: locator.nodeId,
      remoteWorkspaceId,
      sessionGroupId: input.sessionGroupId ?? null,
      remoteSession: {
        id: remoteSession.id,
        title: input.title,
        origin: input.origin ?? 'manual',
        providerTargetId: input.providerTargetId ?? null,
        modelId: input.modelId ?? null,
        thinkingEffort: input.thinkingEffort ?? null,
        runtimeKind: input.runtimeKind ?? 'standard',
        linkedIssueId: input.linkedIssueId ?? null,
        archivedAt: null,
        createdAt: currentUnixSeconds(),
        updatedAt: currentUnixSeconds(),
        latestUserMessageAt: null,
        latestAssistantMessageAt: null,
      },
      projectionKind: 'controller-created',
    })
  }
  catch (error) {
    try {
      await upstreamFetchByBaseUrl(
        baseUrl,
        `/sessions/${encodeURIComponent(remoteSession.id)}`,
        { method: 'DELETE' },
      )
    }
    catch {
      // best-effort compensation after local insert failure
    }
    throw error
  }

  return { localSessionId }
}

export async function removeNodeProjectedSession(localSessionId: string): Promise<void> {
  const link = getNodeSessionLink(localSessionId)
  if (!link) {
    return
  }

  if (link.projectionKind === 'discovered') {
    return
  }

  const baseUrl = (await getFabricNodeLinkManager().ensure(link.nodeId)).localBaseUrl
  const response = await upstreamFetchByBaseUrl(
    baseUrl,
    `/sessions/${encodeURIComponent(link.remoteSessionId)}`,
    { method: 'DELETE' },
  )
  if (!response.ok) {
    throw new AppError({
      code: 'node_session_delete_failed',
      status: response.status >= 500 ? 502 : response.status,
      message: `Remote Cradle Server session delete failed with HTTP ${response.status}.`,
      details: {
        sessionId: localSessionId,
        nodeId: link.nodeId,
        remoteSessionId: link.remoteSessionId,
        status: response.status,
      },
    })
  }
}

interface RemoteSessionSummary {
  id: string
  workspaceId: string | null
  title: string | null
  origin: string
  providerTargetId: string | null
  modelId: string | null
  thinkingEffort: ChatThinkingEffort | null
  runtimeKind: string
  archivedAt: number | null
  createdAt: number
  updatedAt: number
  latestUserMessageAt?: number | null
  latestAssistantMessageAt?: number | null
}

interface RemoteSessionPage {
  items: RemoteSessionSummary[]
  nextCursor: string | null
}

export interface ReconcileNodeSessionsResult {
  workspaceId: string
  nodeId: string
  remoteWorkspaceId: string
  discovered: number
  updated: number
  removed: number
}

function projectionConfigJson(remote: Pick<
  RemoteSessionSummary,
  'modelId' | 'providerTargetId' | 'thinkingEffort'
>): string {
  return JSON.stringify({
    ...(remote.modelId ? { requestedModelId: remote.modelId } : {}),
    ...(remote.providerTargetId ? { requestedProviderTargetId: remote.providerTargetId } : {}),
    ...(remote.thinkingEffort ? { requestedThinkingEffort: remote.thinkingEffort } : {}),
  })
}

/** Reconcile one mounted Node workspace with its authoritative remote sessions. */
export async function reconcileNodeSessionsForWorkspace(
  workspaceId: string,
): Promise<ReconcileNodeSessionsResult> {
  const locator = readNodeWorkspaceLocator(workspaceId)
  if (!locator) {
    throw new AppError({
      code: 'node_workspace_required',
      status: 409,
      message: 'Session reconciliation requires a workspace mounted from a Fabric Node.',
      details: { workspaceId },
    })
  }

  const remoteWorkspaceId = await resolveRemoteWorkspaceIdForLocator(locator)
  const baseUrl = (await getFabricNodeLinkManager().ensure(locator.nodeId)).localBaseUrl
  const remoteSessionsById = new Map<string, RemoteSessionSummary>()
  for (const archived of [false, true]) {
    let cursor: string | null = null
    do {
      const query = new URLSearchParams({
        workspaceId: remoteWorkspaceId,
        archived: String(archived),
        limit: '200',
      })
      if (cursor) {
        query.set('cursor', cursor)
      }
      const page = await upstreamJsonByBaseUrl<RemoteSessionPage>(
        baseUrl,
        `/sessions/?${query.toString()}`,
      )
      for (const remote of page.items) {
        remoteSessionsById.set(remote.id, remote)
      }
      cursor = page.nextCursor
    } while (cursor)
  }

  let discovered = 0
  let updated = 0
  for (const remote of remoteSessionsById.values()) {
    const existing = db()
      .select({
        localSessionId: nodeSessionLinks.localSessionId,
        title: sessions.title,
        updatedAt: sessions.updatedAt,
        latestUserMessageAt: nodeSessionLinks.latestUserMessageAt,
        latestAssistantMessageAt: nodeSessionLinks.latestAssistantMessageAt,
      })
      .from(nodeSessionLinks)
      .innerJoin(sessions, eq(sessions.id, nodeSessionLinks.localSessionId))
      .where(and(
        eq(nodeSessionLinks.nodeId, locator.nodeId),
        eq(nodeSessionLinks.remoteSessionId, remote.id),
      ))
      .get()

    if (existing) {
      const title = remote.title ?? existing.title
      const latestUserMessageAt = remote.latestUserMessageAt ?? null
      const latestAssistantMessageAt = remote.latestAssistantMessageAt ?? null
      const sessionChanged = (
        existing.title !== title
        || existing.updatedAt < remote.updatedAt
      )
      const activityChanged = (
        existing.latestUserMessageAt !== latestUserMessageAt
        || existing.latestAssistantMessageAt !== latestAssistantMessageAt
      )
      if (sessionChanged) {
        db().update(sessions).set({
          title,
          origin: remote.origin,
          runtimeKind: remote.runtimeKind,
          configJson: projectionConfigJson(remote),
          archivedAt: remote.archivedAt,
          updatedAt: remote.updatedAt,
        }).where(eq(sessions.id, existing.localSessionId)).run()
      }
      if (activityChanged) {
        db().update(nodeSessionLinks).set({
          latestUserMessageAt,
          latestAssistantMessageAt,
        }).where(eq(nodeSessionLinks.localSessionId, existing.localSessionId)).run()
      }
      if (sessionChanged || activityChanged) {
        updated += 1
      }
      continue
    }

    const now = currentUnixSeconds()
    const localSessionId = randomUUID()
    db().transaction((tx) => {
      tx.insert(sessions).values({
        id: localSessionId,
        workspaceId,
        title: remote.title ?? 'Untitled',
        origin: remote.origin,
        providerTargetId: null,
        runtimeKind: remote.runtimeKind,
        agentId: null,
        configJson: projectionConfigJson(remote),
        archivedAt: remote.archivedAt,
        createdAt: remote.createdAt,
        updatedAt: remote.updatedAt,
      }).run()
      tx.insert(nodeSessionLinks).values({
        localSessionId,
        nodeId: locator.nodeId,
        remoteSessionId: remote.id,
        remoteWorkspaceId,
        projectionKind: 'discovered',
        latestUserMessageAt: remote.latestUserMessageAt ?? null,
        latestAssistantMessageAt: remote.latestAssistantMessageAt ?? null,
        createdAt: now,
        updatedAt: now,
      }).run()
    })
    discovered += 1
  }

  const staleLocalSessionIds = db()
    .select({
      localSessionId: nodeSessionLinks.localSessionId,
      remoteSessionId: nodeSessionLinks.remoteSessionId,
    })
    .from(nodeSessionLinks)
    .where(and(
      eq(nodeSessionLinks.nodeId, locator.nodeId),
      eq(nodeSessionLinks.remoteWorkspaceId, remoteWorkspaceId),
    ))
    .all()
    .filter(link => !remoteSessionsById.has(link.remoteSessionId))
    .map(link => link.localSessionId)

  if (staleLocalSessionIds.length > 0) {
    db().delete(sessions).where(inArray(sessions.id, staleLocalSessionIds)).run()
  }

  return {
    workspaceId,
    nodeId: locator.nodeId,
    remoteWorkspaceId,
    discovered,
    updated,
    removed: staleLocalSessionIds.length,
  }
}

export function rewritePathForNodeSession(
  upstreamPathWithQuery: string,
  remoteSessionId: string,
): string {
  return upstreamPathWithQuery.replace(
    /\/sessions\/[^/]+/,
    `/sessions/${encodeURIComponent(remoteSessionId)}`,
  )
}

export async function proxyLinkedSessionRequest(
  localSessionId: string,
  upstreamPathWithQuery: string,
  request: Request,
): Promise<Response> {
  const link = requireNodeSessionLink(localSessionId)
  const rewrittenPath = rewritePathForNodeSession(upstreamPathWithQuery, link.remoteSessionId)
  const baseUrl = (await getFabricNodeLinkManager().ensure(link.nodeId)).localBaseUrl
  return await proxyUpstreamRequestByBaseUrl(baseUrl, request, rewrittenPath)
}

export async function tryProxyLinkedSessionRequest(
  localSessionId: string,
  upstreamPathWithQuery: string,
  request: Request,
): Promise<Response | null> {
  const link = getNodeSessionLink(localSessionId)
  if (!link) {
    return null
  }
  return await proxyLinkedSessionRequest(localSessionId, upstreamPathWithQuery, request)
}

export function buildProxiedJsonRequest(
  request: Request,
  body: unknown,
): Request {
  const headers = new Headers(request.headers)
  headers.set('content-type', 'application/json')
  return new Request(request.url, {
    method: request.method,
    headers,
    body: JSON.stringify(body),
    signal: request.signal,
  })
}

/**
 * Fetch the remote session title and update the local projection if it changed.
 * Returns `true` if the title was updated.
 */
export async function syncNodeSessionTitle(localSessionId: string): Promise<boolean> {
  const link = getNodeSessionLink(localSessionId)
  if (!link) {
    return false
  }

  try {
    const baseUrl = (await getFabricNodeLinkManager().ensure(link.nodeId)).localBaseUrl
    const remote = await upstreamJsonByBaseUrl<{ id: string, title: string | null }>(
      baseUrl,
      `/sessions/${encodeURIComponent(link.remoteSessionId)}`,
    )
    if (!remote?.title) {
      return false
    }

    const local = db()
      .select({ title: sessions.title })
      .from(sessions)
      .where(eq(sessions.id, localSessionId))
      .get()
    if (!local || local.title === remote.title) {
      return false
    }

    db()
      .update(sessions)
      .set({ title: remote.title, updatedAt: currentUnixSeconds() })
      .where(eq(sessions.id, localSessionId))
      .run()
    return true
  }
  catch {
    // Best-effort: do not fail the request if title sync fails.
    return false
  }
}
