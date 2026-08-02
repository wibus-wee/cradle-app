import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "provider",
    "list"
  ],
  "description": "List provider targets",
  "flags": [
    {
      "name": "runtimeKind",
      "required": false,
      "target": "query.runtimeKind",
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
    }
  ],
  "method": "get",
  "path": "/provider-targets/"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
