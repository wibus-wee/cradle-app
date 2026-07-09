import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "search",
    "threads"
  ],
  "description": "Search threads",
  "flags": [
    {
      "name": "query",
      "required": true,
      "target": "query.query",
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
      "name": "origin",
      "required": false,
      "target": "query.origin",
      "type": "string"
    },
    {
      "name": "limit",
      "required": false,
      "target": "query.limit",
      "type": "string"
    },
    {
      "name": "snippetsPerHit",
      "required": false,
      "target": "query.snippetsPerHit",
      "type": "string"
    }
  ],
  "method": "get",
  "path": "/search/threads"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
