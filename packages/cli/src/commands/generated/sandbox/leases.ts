import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "sandbox",
    "leases"
  ],
  "description": "List sandbox leases",
  "flags": [
    {
      "name": "workId",
      "required": false,
      "target": "query.workId",
      "type": "string"
    },
    {
      "name": "sessionId",
      "required": false,
      "target": "query.sessionId",
      "type": "string"
    },
    {
      "description": "Defaults to the workspace for your current directory, then CRADLE_WORKSPACE_ID. Pass --all-workspaces to query every workspace.",
      "name": "workspaceId",
      "required": false,
      "target": "query.workspaceId",
      "type": "string",
      "flagName": "workspace",
      "resolver": "workspace",
      "resolverAmbient": true,
      "disableResolverFlag": "allWorkspaces"
    },
    {
      "name": "includeReleased",
      "required": false,
      "target": "query.includeReleased",
      "type": "boolean"
    }
  ],
  "method": "get",
  "path": "/sandboxes/leases"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
