export interface AgentContextEvent {
  id: string
  timestamp: number
  chatSessionId: string
  agentId: string | null
  agentName: string | null
  systemPrompt: string | null
  skillsCatalog: Array<{ name: string, description: string, location: string }>
  historyLength: number
  providerKind: string
}
