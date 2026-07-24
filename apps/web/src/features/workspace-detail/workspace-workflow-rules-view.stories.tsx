import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'

import type { Agent } from '~/features/agent-runtime/types'

import { WorkspaceWorkflowRulesView } from './workspace-workflow-rules-view'

const agentFixtures = [
  {
    id: 'agent-codex',
    name: 'Codex',
    description: 'Implementation agent',
    avatarUrl: null,
    avatarStyle: 'initials',
    avatarSeed: 'codex',
    providerTargetId: 'provider-openai',
    modelId: 'gpt-5.4',
    thinkingEffort: 'high',
    runtimeKind: 'codex',
    configJson: '{}',
    enabled: true,
    createdAt: 1_784_800_000,
    updatedAt: 1_784_860_000,
  },
  {
    id: 'agent-reviewer',
    name: 'Reviewer',
    description: 'Architecture reviewer',
    avatarUrl: null,
    avatarStyle: 'initials',
    avatarSeed: 'reviewer',
    providerTargetId: 'provider-anthropic',
    modelId: 'claude-opus-4-1',
    thinkingEffort: 'medium',
    runtimeKind: 'claude-agent',
    configJson: '{}',
    enabled: true,
    createdAt: 1_784_800_000,
    updatedAt: 1_784_860_000,
  },
] satisfies Agent[]

interface WorkspaceWorkflowRulesStorySceneProps {
  empty?: boolean
  initialAgentId?: string | null
  ready?: boolean
}

function WorkspaceWorkflowRulesStoryScene({
  empty = false,
  initialAgentId = null,
  ready = true,
}: WorkspaceWorkflowRulesStorySceneProps) {
  const [selectedAgentId, setSelectedAgentId] = useState(initialAgentId)
  const [contents, setContents] = useState<Record<string, string>>({
    'global': '# Delivery\n\nKeep the draft pull request current after verified changes.',
    'agent-codex': '# Implementation\n\nUse fixture-driven Views for user-visible surfaces.',
    'agent-reviewer': '# Review\n\nReport dependency leaks and missing rendering seams.',
  })
  const scope = selectedAgentId ?? 'global'

  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <div className="mx-auto max-w-3xl">
        <WorkspaceWorkflowRulesView
          agents={empty ? [] : agentFixtures}
          selectedAgentId={selectedAgentId}
          content={contents[scope] ?? null}
          ready={ready}
          onSelectedAgentId={setSelectedAgentId}
          onSave={(agentId, content) => {
            setContents(current => ({
              ...current,
              [agentId ?? 'global']: content,
            }))
          }}
        />
      </div>
    </main>
  )
}

const meta = {
  title: 'App/Workspace/Workspace Workflow Rules',
  component: WorkspaceWorkflowRulesStoryScene,
  parameters: {
    layout: 'fullscreen',
    controls: { disable: true },
  },
} satisfies Meta<typeof WorkspaceWorkflowRulesStoryScene>

export default meta

type Story = StoryObj<typeof meta>

export const GlobalRules: Story = {}

export const AgentRules: Story = {
  args: {
    initialAgentId: 'agent-codex',
  },
}

export const NoIssueAgents: Story = {
  args: {
    empty: true,
  },
}

export const Pending: Story = {
  args: {
    ready: false,
  },
}
