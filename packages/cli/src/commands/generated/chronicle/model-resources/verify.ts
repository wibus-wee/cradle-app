import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "name": "category",
      "required": true,
      "target": "path.category",
      "type": "string"
    }
  ],
  "command": [
    "chronicle",
    "model-resources",
    "verify"
  ],
  "description": "Verify a Chronicle local model resource",
  "flags": [],
  "method": "post",
  "path": "/chronicle/model-resources/{category}/verify"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
