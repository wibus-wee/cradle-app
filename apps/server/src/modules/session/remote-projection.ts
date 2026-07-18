import { randomUUID } from 'node:crypto'

import { remoteSessionLinks, sessions } from '@cradle/db'
import { eq } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { db } from '../../infra'
import type { ChatThinkingEffort } from '../chat-runtime/runtime-provider-types'
import type { ChatRuntimeSettingsUpdatePatch } from '../chat-runtime/runtime-settings-api'
import type { RuntimeKind } from '../provider-contracts/types'
import {
  ensureRemoteHostConnected,
  proxyRemoteHostUpstreamRequest,
  resolveRemoteWorkspaceByPath,
} from '../remote-hosts/service'
import {
  upstreamFetchByBaseUrl,
  upstreamJsonByBaseUrl,
} from '../remote-hosts/upstream'
import * as Workspace from '../workspace/service'
import {
  isLocalWorkspaceLocator,
} from '../workspace/workspace-locator'

export interface RemoteSessionLinkView {
  localSessionId: string
  hostId: string
  remoteSessionId: string
  remoteWorkspaceId: string
  createdAt: number
  updatedAt: number
}

export type SessionExecutionTarget
  = | { kind: 'local' }
    | { kind: 'remote-host', hostId: string, remoteSessionId: string }

export function getRemoteSessionLink(localSessionId: string): RemoteSessionLinkView | null {
  const row = db()
    .select()
    .from(remoteSessionLinks)
    .where(eq(remoteSessionLinks.localSessionId, localSessionId))
    .get()
  if (!row) {
    return null
  }
  return {
    localSessionId: row.localSessionId,
    hostId: row.hostId,
    remoteSessionId: row.remoteSessionId,
    remoteWorkspaceId: row.remoteWorkspaceId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function isRemoteProjectedSession(localSessionId: string): boolean {
  return getRemoteSessionLink(localSessionId) !== null
}

export function requireRemoteSessionLink(localSessionId: string): RemoteSessionLinkView {
  const link = getRemoteSessionLink(localSessionId)
  if (!link) {
    throw new AppError({
      code: 'remote_session_link_not_found',
      status: 404,
      message: 'Remote session link was not found for this local session projection.',
      details: { sessionId: localSessionId },
    })
  }
  return link
}

export function readSessionExecutionTarget(localSessionId: string): SessionExecutionTarget {
  const link = getRemoteSessionLink(localSessionId)
  if (!link) {
    return { kind: 'local' }
  }
  return {
    kind: 'remote-host',
    hostId: link.hostId,
    remoteSessionId: link.remoteSessionId,
  }
}

function readRemoteWorkspaceLocator(workspaceId: string) {
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
  locator: { hostId: string, path: string, sourceWorkspaceId?: string | null },
): Promise<string> {
  if (locator.sourceWorkspaceId) {
    return locator.sourceWorkspaceId
  }
  const remoteWorkspace = await resolveRemoteWorkspaceByPath(locator.hostId, locator.path)
  if (!remoteWorkspace) {
    throw new AppError({
      code: 'remote_cradle_workspace_not_resolved',
      status: 409,
      message: 'Remote workspace could not be resolved for session projection.',
      details: { hostId: locator.hostId, path: locator.path },
    })
  }
  return remoteWorkspace.id
}

interface RemoteSessionCreateResponse {
  id: string
}

export async function createRemoteProjectedSession(input: {
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
  const locator = readRemoteWorkspaceLocator(input.workspaceId)
  if (!locator) {
    throw new AppError({
      code: 'remote_session_link_required',
      status: 409,
      message: 'Session workspace is not mounted from a remote Cradle Server host.',
      details: { workspaceId: input.workspaceId },
    })
  }

  await ensureRemoteHostConnected(locator.hostId)
  const remoteWorkspaceId = await resolveRemoteWorkspaceIdForLocator(locator)
  const localSessionId = input.id ?? randomUUID()

  const { baseUrl } = await ensureRemoteHostConnected(locator.hostId)
  let remoteSession: RemoteSessionCreateResponse
  try {
    remoteSession = await upstreamJsonByBaseUrl<RemoteSessionCreateResponse>(baseUrl, '/sessions', {
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
          details: { hostId: locator.hostId },
        })
  }

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
          configJson: '{}',
          linkedIssueId: input.linkedIssueId ?? null,
          sessionGroupId: input.sessionGroupId ?? null,
        })
        .run()

      tx.insert(remoteSessionLinks)
        .values({
          localSessionId,
          hostId: locator.hostId,
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

export async function removeRemoteProjectedSession(localSessionId: string): Promise<void> {
  const link = getRemoteSessionLink(localSessionId)
  if (!link) {
    return
  }

  const { baseUrl } = await ensureRemoteHostConnected(link.hostId)
  const response = await upstreamFetchByBaseUrl(
    baseUrl,
    `/sessions/${encodeURIComponent(link.remoteSessionId)}`,
    { method: 'DELETE' },
  )
  if (!response.ok) {
    throw new AppError({
      code: 'remote_session_delete_failed',
      status: response.status >= 500 ? 502 : response.status,
      message: `Remote Cradle Server session delete failed with HTTP ${response.status}.`,
      details: {
        sessionId: localSessionId,
        hostId: link.hostId,
        remoteSessionId: link.remoteSessionId,
        status: response.status,
      },
    })
  }
}

export function rewritePathForRemoteSession(
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
  const link = requireRemoteSessionLink(localSessionId)
  const rewrittenPath = rewritePathForRemoteSession(upstreamPathWithQuery, link.remoteSessionId)
  return await proxyRemoteHostUpstreamRequest(link.hostId, request, rewrittenPath)
}

export async function tryProxyLinkedSessionRequest(
  localSessionId: string,
  upstreamPathWithQuery: string,
  request: Request,
): Promise<Response | null> {
  const link = getRemoteSessionLink(localSessionId)
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
