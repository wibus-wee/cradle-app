import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "description": "Defaults to CRADLE_WORKSPACE_ID.",
      "name": "workspaceId",
      "required": true,
      "target": "path.workspaceId",
      "type": "string",
      "envDefault": "CRADLE_WORKSPACE_ID"
    }
  ],
  "command": [
    "workspace",
    "diffs",
    "readiness"
  ],
  "description": "List diff review source readiness",
  "flags": [],
  "method": "get",
  "path": "/workspaces/{workspaceId}/diff-reviews/source-readiness"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
