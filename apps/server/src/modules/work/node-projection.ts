import type { Work } from '@cradle/db'
import { nodeWorkLinks } from '@cradle/db'
import { eq } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { upstreamJsonByBaseUrl } from '../../http/upstream'
import { db } from '../../infra'
import type { PullRequestReadiness, SessionPullRequestView } from '../pull-request/service'
import { getFabricNodeLinkManager } from '../relay-transport/node-link-manager'
import { resolveRemoteWorkspaceIdForLocator } from '../session/node-projection'
import type { SessionView } from '../session/service'
import * as Workspace from '../workspace/service'
import { isLocalWorkspaceLocator } from '../workspace/workspace-locator'
import type { SessionIsolationView } from '../worktree/service'
import type { WorkPage } from './service'

export interface NodeWorkLinkView {
  localWorkId: string
  nodeId: string
  remoteWorkId: string
  remoteWorkspaceId: string
  createdAt: number
  updatedAt: number
}

export interface RemoteWorkDetail {
  work: Work
  primaryThread: SessionView
  execution: SessionIsolationView
  readiness: PullRequestReadiness
  pullRequest: SessionPullRequestView | null
  activity: 'idle' | 'running' | 'waiting' | 'blocked'
}

export function getNodeWorkLink(localWorkId: string): NodeWorkLinkView | null {
  return db()
    .select()
    .from(nodeWorkLinks)
    .where(eq(nodeWorkLinks.localWorkId, localWorkId))
    .get() ?? null
}

export async function resolveNodeWorkAuthority(workspaceId: string): Promise<{
  nodeId: string
  remoteWorkspaceId: string
  baseUrl: string
} | null> {
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
  const remoteWorkspaceId = await resolveRemoteWorkspaceIdForLocator(workspace.locator)
  const baseUrl = (await getFabricNodeLinkManager().ensure(workspace.locator.nodeId)).localBaseUrl
  return {
    nodeId: workspace.locator.nodeId,
    remoteWorkspaceId,
    baseUrl,
  }
}

export async function createRemoteWork(
  authority: { remoteWorkspaceId: string, baseUrl: string },
  body: Record<string, unknown>,
): Promise<RemoteWorkDetail> {
  return await upstreamJsonByBaseUrl<RemoteWorkDetail>(authority.baseUrl, '/works', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, workspaceId: authority.remoteWorkspaceId }),
  })
}

export async function listRemoteWorks(
  authority: { remoteWorkspaceId: string, baseUrl: string },
  input: { archived: boolean, cursor?: string, limit: number },
): Promise<WorkPage> {
  const query = new URLSearchParams({
    workspaceId: authority.remoteWorkspaceId,
    archived: String(input.archived),
    limit: String(input.limit),
  })
  if (input.cursor) {
    query.set('cursor', input.cursor)
  }
  return await upstreamJsonByBaseUrl<WorkPage>(
    authority.baseUrl,
    `/works?${query.toString()}`,
  )
}

async function baseUrlForLink(link: NodeWorkLinkView): Promise<string> {
  return (await getFabricNodeLinkManager().ensure(link.nodeId)).localBaseUrl
}

export async function readRemoteWork(link: NodeWorkLinkView): Promise<RemoteWorkDetail> {
  const baseUrl = await baseUrlForLink(link)
  return await upstreamJsonByBaseUrl<RemoteWorkDetail>(
    baseUrl,
    `/works/${encodeURIComponent(link.remoteWorkId)}`,
  )
}

export async function mutateRemoteWork(
  link: NodeWorkLinkView,
  action: 'archive' | 'prepare' | 'submit' | 'branch',
  body: Record<string, unknown>,
): Promise<RemoteWorkDetail> {
  const baseUrl = await baseUrlForLink(link)
  return await upstreamJsonByBaseUrl<RemoteWorkDetail>(
    baseUrl,
    `/works/${encodeURIComponent(link.remoteWorkId)}/${action}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
}
