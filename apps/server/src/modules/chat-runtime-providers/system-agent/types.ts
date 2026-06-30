/**
 * Output: System Agent provider-private types shared inside the package.
 * Input: jar-core event names and Cradle runtime configuration needs.
 * Position: System Agent provider package type boundary.
 */

export type JarvisThinkingLevel = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

export type SystemAgentAssistantMessageEvent = {
  type: string
  delta?: string
  contentIndex?: number
  [key: string]: unknown
}
