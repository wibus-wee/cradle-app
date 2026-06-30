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
    "get"
  ],
  "description": "Get a Chronicle activity segment",
  "flags": [],
  "method": "get",
  "path": "/chronicle/activity-segments/{segmentId}"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
