import { randomUUID } from 'node:crypto'

import { nodeSessionLinks, sessions } from '@cradle/db'
import { eq, inArray } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { currentUnixSeconds } from '../../helpers/time'
import { db } from '../../infra'
import type { ChatThinkingEffort } from '../chat-runtime/runtime-provider-types'
import type { ChatRuntimeSettingsUpdatePatch } from '../chat-runtime/runtime-settings-api'
import type { RuntimeKind } from '../provider-contracts/types'
import { getFabricNodeLinkManager } from '../fabric/node-link-manager'
import {
  proxyUpstreamRequestByBaseUrl,
  upstreamFetchByBaseUrl,
  upstreamJsonByBaseUrl,
} from '../remote-hosts/upstream'
import * as Workspace from '../workspace/service'
import {
  isLocalWorkspaceLocator,
} from '../workspace/workspace-locator'

export interface NodeSessionLinkView {
  localSessionId: string
  nodeId: string
  remoteSessionId: string
  remoteWorkspaceId: string
  createdAt: number
  updatedAt: number
}

export type SessionExecutionTarget
  = | { kind: 'local' }
    | { kind: 'node', nodeId: string, remoteSessionId: string }

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
  locator: { nodeId: string, path: string, sourceWorkspaceId?: string | null },
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

  const localConfigJson = JSON.stringify({
    ...(input.modelId ? { requestedModelId: input.modelId } : {}),
    ...(input.providerTargetId ? { requestedProviderTargetId: input.providerTargetId } : {}),
    ...(input.thinkingEffort ? { requestedThinkingEffort: input.thinkingEffort } : {}),
  })

  try {
    db().transaction((tx) => {
      tx.insert(sessions)
        .values({
          id: localSessionId,
          workspaceId: input.workspaceId,
          title: input.title,
          origin: input.origin ?? 'manual',
          providerTargetId: null,
          runtimeKind: input.runtimeKind ?? 'standard',
          agentId: null,
          configJson: localConfigJson,
          linkedIssueId: input.linkedIssueId ?? null,
          sessionGroupId: input.sessionGroupId ?? null,
        })
        .run()

      tx.insert(nodeSessionLinks)
        .values({
          localSessionId,
          nodeId: locator.nodeId,
          remoteSessionId: remoteSession.id,
          remoteWorkspaceId,
        })
        .run()
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
