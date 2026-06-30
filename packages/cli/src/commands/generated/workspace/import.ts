import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "workspace",
    "import"
  ],
  "description": "Import workspace from directory",
  "flags": [
    {
      "name": "path",
      "required": true,
      "target": "body.path",
      "type": "string"
    }
  ],
  "method": "post",
  "path": "/workspaces/from-directory"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
