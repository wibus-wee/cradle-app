import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "name": "memoryId",
      "required": true,
      "target": "path.memoryId",
      "type": "string"
    }
  ],
  "command": [
    "chronicle",
    "memories",
    "delete"
  ],
  "description": "Delete a Chronicle memory",
  "flags": [],
  "method": "delete",
  "path": "/chronicle/memories/{memoryId}"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
