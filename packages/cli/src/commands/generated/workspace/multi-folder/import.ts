import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "workspace",
    "multi-folder",
    "import"
  ],
  "description": "Import multi-folder workspace config",
  "flags": [
    {
      "name": "path",
      "required": true,
      "target": "body.path",
      "type": "string"
    }
  ],
  "method": "post",
  "path": "/workspaces/multi-folder/from-config"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
