import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "name": "owner",
      "required": true,
      "target": "path.owner",
      "type": "string"
    },
    {
      "name": "repo",
      "required": true,
      "target": "path.repo",
      "type": "string"
    },
    {
      "name": "number",
      "required": true,
      "target": "path.number",
      "type": "string"
    }
  ],
  "command": [
    "pull-request",
    "detail",
    "refresh"
  ],
  "description": "Synchronously refresh pull request details from GitHub",
  "flags": [
    {
      "name": "force",
      "required": false,
      "target": "body.force",
      "type": "boolean"
    }
  ],
  "method": "post",
  "path": "/pull-requests/{owner}/{repo}/{number}/refresh"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
