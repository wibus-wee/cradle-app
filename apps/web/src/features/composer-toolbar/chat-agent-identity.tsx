import { AgentAvatar } from '~/features/agent-runtime/agent-avatar'
import type { Agent } from '~/features/agent-runtime/use-agents'

interface ChatAgentIdentityProps {
  agent: Agent
}

export function ChatAgentIdentity({ agent }: ChatAgentIdentityProps) {
  return (
    <div
      className="inline-flex h-6 min-w-0 max-w-48 shrink-0 items-center gap-1.5 rounded-[min(var(--radius-md),10px)] px-2 text-xs font-medium text-foreground"
      data-testid="chat-agent-identity"
      aria-label={agent.name}
      title={agent.name}
    >
      <AgentAvatar
        name={agent.name}
        avatarUrl={agent.avatarUrl}
        avatarStyle={agent.avatarStyle}
        avatarSeed={agent.avatarSeed}
        size={16}
      />
      <span className="min-w-0 truncate">{agent.name}</span>
    </div>
  )
}
