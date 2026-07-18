import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
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
    "work",
    "rename-branch"
  ],
  "description": "Rename the Work branch before the first pull request exists",
  "flags": [
    {
      "name": "branch",
      "required": true,
      "target": "body.branch",
      "type": "string"
    }
  ],
  "method": "post",
  "path": "/works/{id}/branch"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
