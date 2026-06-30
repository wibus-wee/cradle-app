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
    "crystallize"
  ],
  "description": "Run Chronicle activity segment knowledge crystallization",
  "flags": [],
  "method": "post",
  "path": "/chronicle/activity-segments/{segmentId}/crystallize"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
