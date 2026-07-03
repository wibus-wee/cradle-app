import { useQuery } from '@tanstack/react-query'

import {
  getSessionsByIdOptions,
  getWorkspacesByWorkspaceIdOptions,
} from '~/api-gen/@tanstack/react-query.gen'
import type { SessionLayoutRecord, WorkspaceLayoutRecord } from '~/components/layout/layout-records'
import { getLocalWorkspacePath } from '~/features/workspace/types'

export function useChatSessionLayoutRecord(sessionId: string | null): SessionLayoutRecord | undefined {
  const query = useQuery({
    ...getSessionsByIdOptions({ path: { id: sessionId ?? '' } }),
    enabled: !!sessionId,
    staleTime: 60_000,
    select: data => data
      ? {
          sessionId: data.id,
          sessionTitle: data.title ?? null,
          workspaceId: data.workspaceId ?? null,
          workspacePath: null,
          runtimeKind: data.runtimeKind ?? null,
        } satisfies SessionLayoutRecord
      : undefined,
  })

  return query.data
}

export function useWorkspaceLayoutRecord(workspaceId: string | null): WorkspaceLayoutRecord | undefined {
  const query = useQuery({
    ...getWorkspacesByWorkspaceIdOptions({ path: { workspaceId: workspaceId ?? '' } }),
    enabled: !!workspaceId,
    staleTime: 60_000,
    select: data => data
      ? {
          workspaceId: data.id,
          workspaceName: data.name ?? null,
          workspacePath: getLocalWorkspacePath(data),
        } satisfies WorkspaceLayoutRecord
      : undefined,
  })

  return query.data
}
