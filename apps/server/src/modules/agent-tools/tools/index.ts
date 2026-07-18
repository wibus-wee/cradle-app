import type { AgentToolRegistration } from '../registry'
import { workSubmitTool } from './work/submit'

export const builtinAgentTools: readonly AgentToolRegistration[] = [
  workSubmitTool,
]
