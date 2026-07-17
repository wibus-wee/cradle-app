import { useQuery } from '@tanstack/react-query'

import { postAcpAgentsByAgentIdDraftSession } from '~/api-gen/sdk.gen'

export interface AcpDraftModel {
  id: string
  label: string
}

export interface AcpDraftSession {
  sessionId: string
  selectedModelId: string | null
  models: AcpDraftModel[]
}

export function useAcpDraftSession(input: {
  agentId: string | null
  workspaceId?: string | null
  enabled: boolean
}) {
  const { agentId, workspaceId = null, enabled } = input
  const query = useQuery({
    queryKey: ['acp', 'draft-session', agentId ?? 'no-agent', workspaceId ?? 'no-workspace'],
    enabled: enabled && !!agentId,
    queryFn: async (): Promise<AcpDraftSession> => {
      const { data } = await postAcpAgentsByAgentIdDraftSession({
        path: { agentId: agentId! },
        body: workspaceId ? { workspaceId } : {},
      })
      if (!data) {
        throw new Error('ACP agent did not return a draft session')
      }
      return data
    },
    staleTime: Infinity,
  })

  return { ...query, draftSession: query.data ?? null }
}
