import { GlobeLine as GlobeIcon, RobotLine as BotIcon } from '@mingcute/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { z } from 'zod'

import { getWorkflowRulesByWorkspaceId, putWorkflowRulesByWorkspaceId } from '~/api-gen'
import { MarkdownEditor } from '~/components/editor/markdown-editor'
import { useAgents } from '~/features/agent-runtime/use-agents'
import { cn } from '~/lib/cn'

const WorkflowRuleSchema = z.object({
  global: z.string().nullable(),
  agentSpecific: z.string().nullable(),
})

function useSaveWorkflowRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (params: { workspaceId: string, agentId: string | null, content: string }) => {
      await putWorkflowRulesByWorkspaceId({
        path: { workspaceId: params.workspaceId },
        body: { agentId: params.agentId, content: params.content },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-rules'] })
    },
  })
}

function RuleEditor({
  agentId,
  content,
  placeholder,
  onSave,
}: {
  agentId: string | null
  content: string | null
  placeholder: string
  onSave: (agentId: string | null, content: string) => void
}) {
  const handleSave = (md: string) => {
    onSave(agentId, md)
  }

  return (
    <div
      data-testid="workspace-workflow-rules-editor"
      data-workflow-scope={agentId ?? 'global'}
    >
      <MarkdownEditor
        content={content}
        documentId={`workflow-rule:${agentId ?? 'global'}`}
        onSave={handleSave}
        placeholder={placeholder}
      />
    </div>
  )
}

export function WorkspaceWorkflowRules({
  workspaceId,
  selectedAgentId,
  onSelectedAgentId,
}: {
  workspaceId: string
  selectedAgentId: string | null
  onSelectedAgentId: (agentId: string | null) => void
}) {
  const { agents, isSuccess: agentsReady } = useAgents()
  const issueAgentEligibleAgents = agents.filter(agent => agent.enabled && agent.providerTargetId)
  const activeScope = selectedAgentId
    ? issueAgentEligibleAgents.find(agent => agent.id === selectedAgentId)
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
    enabled: !!workspaceId && (!selectedAgentId || !!activeScope),
  })
  const saveMutation = useSaveWorkflowRule()

  const content = selectedAgentId
    ? (workflowRule.data?.agentSpecific ?? null)
    : (workflowRule.data?.global ?? null)
  const ready = agentsReady && workflowRule.isSuccess

  useEffect(() => {
    if (!agentsReady || !selectedAgentId || activeScope) {
      return
    }
    onSelectedAgentId(null)
  }, [activeScope, agentsReady, onSelectedAgentId, selectedAgentId])

  const handleSave = (agentId: string | null, content: string) => {
    saveMutation.mutate({ workspaceId, agentId, content })
  }

  return (
    <div
      className="space-y-6"
      data-testid="workspace-workflow-rules-page"
      data-workspace-workflow-rules-ready={ready ? 'true' : 'false'}
    >
      {/* Scope selector */}
      <div className="flex gap-1.5" data-testid="workspace-workflow-rules-scope-selector">
        <button
          type="button"
          onClick={() => onSelectedAgentId(null)}
          data-testid="workspace-workflow-rules-scope-global"
          data-scope-active={!selectedAgentId ? 'true' : 'false'}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors',
            !selectedAgentId
              ? 'bg-accent text-foreground font-medium'
              : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
          )}
        >
          <GlobeIcon className="size-3" />
          All Agents
        </button>
        {issueAgentEligibleAgents.map(agent => (
          <button
            key={agent.id}
            type="button"
            onClick={() => onSelectedAgentId(agent.id)}
            data-testid={`workspace-workflow-rules-scope-agent-${agent.id}`}
            data-scope-active={selectedAgentId === agent.id ? 'true' : 'false'}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors',
              selectedAgentId === agent.id
                ? 'bg-accent text-foreground font-medium'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
            )}
          >
            {agent.avatarUrl
              ? (
                <img
                  src={agent.avatarUrl}
                  alt=""
                  className="size-3.5 rounded"
                  crossOrigin="anonymous"
                />
              )
              : <BotIcon className="size-3" />}
            {agent.name}
          </button>
        ))}
      </div>

      {/* Editor area */}
      <div>
        {!selectedAgentId
          ? (
            <RuleEditor
              key="workflow-rule-global"
              agentId={null}
              content={content}
              placeholder="Define what agents should do when assigned a task..."
              onSave={handleSave}
            />
          )
          : activeScope && (
            <RuleEditor
              key={`workflow-rule-agent-${selectedAgentId}`}
              agentId={selectedAgentId}
              content={content}
              placeholder={`Instructions specific to ${activeScope.name}...`}
              onSave={handleSave}
            />
          )}
      </div>

      {/* Info note */}
      {issueAgentEligibleAgents.length === 0 && (
        <div className="py-8 text-center text-[11px] text-muted-foreground/40">
          No issue agents configured yet
        </div>
      )}
    </div>
  )
}
