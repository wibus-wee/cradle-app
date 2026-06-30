/**
 * Output: opencode prompt parts projected from Chat Runtime input.
 * Input: Cradle UIMessage.
 * Position: opencode provider package boundary from Cradle message input to opencode session.prompt body.
 */

import type { TextPartInput } from '@opencode-ai/sdk'

import type { StreamTurnInput } from '../../chat-runtime/runtime-provider-types'
import { projectTextOnlyInput } from '../../chat-runtime/ui-message-input'

export function projectOpencodePromptParts(message: StreamTurnInput['message']): TextPartInput[] {
  return [{
    type: 'text',
    text: projectTextOnlyInput(message, 'opencode provider'),
  }]
}
