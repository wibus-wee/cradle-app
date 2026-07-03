/**
 * Output: System Agent user prompt projected from Chat Runtime input.
 * Input: Cradle UIMessage or text input.
 * Position: System Agent provider package boundary from Cradle input to jar-core prompt text.
 */

import type { StreamTurnInput } from '../../chat-runtime/runtime-provider-types'
import { projectTextOnlyInput } from '../kit/input-projector'

export function projectSystemAgentUserPrompt(message: StreamTurnInput['message']): string {
  return projectTextOnlyInput(message, 'Jarvis provider')
}
