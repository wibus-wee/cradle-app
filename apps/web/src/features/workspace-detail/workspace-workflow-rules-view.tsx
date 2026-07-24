import { GlobeLine as GlobeIcon, RobotLine as BotIcon } from '@mingcute/react'

import type { Agent } from '~/features/agent-runtime/types'
import { cn } from '~/lib/cn'

import { WorkspaceWorkflowRuleEditorView } from './workspace-workflow-rule-editor-view'

export interface WorkspaceWorkflowRulesViewProps {
  agents: Agent[]
  selectedAgentId: string | null
  content: string | null
  ready: boolean
  onSelectedAgentId: (agentId: string | null) => void
  onSave: (agentId: string | null, content: string) => void
}

export function WorkspaceWorkflowRulesView({
  agents,
  selectedAgentId,
  content,
  ready,
  onSelectedAgentId,
  onSave,
}: WorkspaceWorkflowRulesViewProps) {
  const activeAgent = selectedAgentId
    ? agents.find(agent => agent.id === selectedAgentId)
    : null

  return (
    <div
      className="space-y-6"
      data-testid="workspace-workflow-rules-page"
      data-workspace-workflow-rules-ready={ready ? 'true' : 'false'}
    >
      <div
        className="flex gap-1.5 overflow-x-auto scrollbar-none"
        data-testid="workspace-workflow-rules-scope-selector"
      >
        <button
          type="button"
          onClick={() => onSelectedAgentId(null)}
          data-testid="workspace-workflow-rules-scope-global"
          data-scope-active={!selectedAgentId ? 'true' : 'false'}
          className={cn(
            'flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors',
            !selectedAgentId
              ? 'bg-accent font-medium text-foreground'
              : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
          )}
        >
          <GlobeIcon className="size-3" />
          All Agents
        </button>
        {agents.map(agent => (
          <button
            key={agent.id}
            type="button"
            onClick={() => onSelectedAgentId(agent.id)}
            data-testid={`workspace-workflow-rules-scope-agent-${agent.id}`}
            data-scope-active={selectedAgentId === agent.id ? 'true' : 'false'}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors',
              selectedAgentId === agent.id
                ? 'bg-accent font-medium text-foreground'
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

      <div>
        {!selectedAgentId
          ? (
              <WorkspaceWorkflowRuleEditorView
                key="workflow-rule-global"
                agentId={null}
                content={content}
                placeholder="Define what agents should do when assigned a task..."
                onSave={onSave}
              />
            )
          : activeAgent
            ? (
                <WorkspaceWorkflowRuleEditorView
                  key={`workflow-rule-agent-${selectedAgentId}`}
                  agentId={selectedAgentId}
                  content={content}
                  placeholder={`Instructions specific to ${activeAgent.name}...`}
                  onSave={onSave}
                />
              )
            : null}
      </div>

      {agents.length === 0
        ? (
            <div className="py-8 text-center text-[11px] text-muted-foreground/40">
              No issue agents configured yet
            </div>
          )
        : null}
    </div>
  )
}
