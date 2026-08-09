export type JarvisThinkingLevel = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

export type SystemAgentAssistantMessageEvent = {
  type: string
  delta?: string
  contentIndex?: number
  [key: string]: unknown
}
