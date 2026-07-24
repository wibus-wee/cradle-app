import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { z } from 'zod'

import {
  getWorkflowRulesByWorkspaceId,
  putWorkflowRulesByWorkspaceId,
} from '~/api-gen'
import { useAgents } from '~/features/agent-runtime/use-agents'

import { WorkspaceWorkflowRulesView } from './workspace-workflow-rules-view'

const WorkflowRuleSchema = z.object({
  global: z.string().nullable(),
  agentSpecific: z.string().nullable(),
})

export interface WorkspaceWorkflowRulesContainerProps {
  workspaceId: string
  selectedAgentId: string | null
  onSelectedAgentId: (agentId: string | null) => void
}

export function WorkspaceWorkflowRulesContainer({
  workspaceId,
  selectedAgentId,
  onSelectedAgentId,
}: WorkspaceWorkflowRulesContainerProps) {
  const queryClient = useQueryClient()
  const { agents, isSuccess: agentsReady } = useAgents()
  const eligibleAgents = agents.filter(
    agent => agent.enabled && agent.providerTargetId,
  )
  const activeAgent = selectedAgentId
    ? eligibleAgents.find(agent => agent.id === selectedAgentId)
    : null
  const workflowRule = useQuery({
    queryKey: ['workflow-rules', workspaceId, selectedAgentId],
    queryFn: async () => {
      const { data } = await getWorkflowRulesByWorkspaceId({
        path: { workspaceId },
        query: selectedAgentId ? { agentId: selectedAgentId } : {},
      })
      return WorkflowRuleSchema.parse(data)
    },
    enabled: !!workspaceId && (!selectedAgentId || !!activeAgent),
  })
  const saveMutation = useMutation({
    mutationFn: async (params: {
      agentId: string | null
      content: string
    }) => {
      await putWorkflowRulesByWorkspaceId({
        path: { workspaceId },
        body: {
          agentId: params.agentId,
          content: params.content,
        },
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workflow-rules'] })
    },
  })
  const content = selectedAgentId
    ? (workflowRule.data?.agentSpecific ?? null)
    : (workflowRule.data?.global ?? null)

  useEffect(() => {
    if (!agentsReady || !selectedAgentId || activeAgent) {
      return
    }
    onSelectedAgentId(null)
  }, [activeAgent, agentsReady, onSelectedAgentId, selectedAgentId])

  return (
    <WorkspaceWorkflowRulesView
      agents={eligibleAgents}
      selectedAgentId={selectedAgentId}
      content={content}
      ready={agentsReady && workflowRule.isSuccess}
      onSelectedAgentId={onSelectedAgentId}
      onSave={(agentId, nextContent) => {
        saveMutation.mutate({ agentId, content: nextContent })
      }}
    />
  )
}
