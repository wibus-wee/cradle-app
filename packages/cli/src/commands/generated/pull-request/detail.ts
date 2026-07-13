import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
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
    "detail"
  ],
  "description": "Get live GitHub pull request details by owner/repo/number, independent of any Cradle session",
  "flags": [],
  "method": "get",
  "path": "/pull-requests/{owner}/{repo}/{number}/detail"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
