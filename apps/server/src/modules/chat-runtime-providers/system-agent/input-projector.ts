import type { StreamTurnInput } from '../../chat-runtime/runtime-provider-types'
import { projectTextOnlyInput } from '../kit/input-projector'

export function projectSystemAgentUserPrompt(message: StreamTurnInput['message']): string {
  return projectTextOnlyInput(message, 'Jarvis provider')
}
