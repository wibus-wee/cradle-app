import type { Agent } from '~/features/agent-runtime/use-agents'
import type { KanbanIssue } from '~/features/kanban/types'

type IssueDelegationFields = Pick<KanbanIssue, 'delegateAgentId' | 'delegateProviderTargetId'>

export function findDelegatedAgent(issue: IssueDelegationFields, agents: Agent[]): Agent | null {
  const delegateAgentId = issue.delegateAgentId?.trim()
  const delegateProviderTargetId = issue.delegateProviderTargetId?.trim()

  if (delegateAgentId) {
    const agent = agents.find(candidate => candidate.id === delegateAgentId)
    if (agent) {
      return agent
    }
  }

  if (!delegateProviderTargetId) {
    return null
  }

  return agents.find(candidate => candidate.providerTargetId === delegateProviderTargetId) ?? null
}
