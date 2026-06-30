import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "name": "segmentId",
      "required": true,
      "target": "path.segmentId",
      "type": "string"
    }
  ],
  "command": [
    "chronicle",
    "activity-segments",
    "summarize"
  ],
  "description": "Run Chronicle activity segment summarization",
  "flags": [],
  "method": "post",
  "path": "/chronicle/activity-segments/{segmentId}/summarize"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
