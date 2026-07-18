import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "name": "id",
      "required": true,
      "target": "path.id",
      "type": "string"
    }
  ],
  "command": [
    "plugin",
    "source",
    "uninstall-plan"
  ],
  "description": "Inspect plugin source uninstall effects",
  "flags": [],
  "method": "get",
  "path": "/plugins/sources/{id}/uninstall-plan"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
