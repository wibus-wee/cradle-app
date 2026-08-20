import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "work",
    "reconcile-node-projections"
  ],
  "description": "Reconcile Works from a mounted Fabric Node workspace",
  "flags": [
    {
      "description": "Defaults to the workspace for your current directory, then CRADLE_WORKSPACE_ID.",
      "name": "workspaceId",
      "required": true,
      "target": "body.workspaceId",
      "type": "string",
      "flagName": "workspace",
      "resolver": "workspace",
      "resolverAmbient": true
    }
  ],
  "method": "post",
  "path": "/works/node-projections/reconcile"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
