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
    "get"
  ],
  "description": "Get a Chronicle memory",
  "flags": [],
  "method": "get",
  "path": "/chronicle/memories/{memoryId}"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
