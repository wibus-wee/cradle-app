import type { AgentToolRegistration } from '../registry'
import { recallQueryTool } from './recall/recall-query'
import { managePullRequestTool } from './work/manage-pull-request'

export const builtinAgentTools: readonly AgentToolRegistration[] = [
  recallQueryTool,
  managePullRequestTool,
]
