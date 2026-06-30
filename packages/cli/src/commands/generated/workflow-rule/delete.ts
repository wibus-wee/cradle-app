import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "name": "workspaceId",
      "required": true,
      "target": "path.workspaceId",
      "type": "string"
    }
  ],
  "command": [
    "workflow-rule",
    "delete"
  ],
  "description": "Delete workflow rule",
  "flags": [
    {
      "name": "agentId",
      "required": false,
      "target": "query.agentId",
      "type": "string"
    }
  ],
  "method": "delete",
  "path": "/workflow-rules/{workspaceId}"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
