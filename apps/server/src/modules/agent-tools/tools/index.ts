import type { AgentToolRegistration } from '../registry'
import { managePullRequestTool } from './work/manage-pull-request'

export const builtinAgentTools: readonly AgentToolRegistration[] = [
  managePullRequestTool,
]
