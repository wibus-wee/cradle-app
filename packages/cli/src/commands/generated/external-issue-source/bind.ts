import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "name": "sourceKey",
      "required": true,
      "target": "path.sourceKey",
      "type": "string"
    }
  ],
  "command": [
    "external-issue-source",
    "bind"
  ],
  "description": "Bind an external issue repository to a workspace",
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
    },
    {
      "name": "repositoryOwner",
      "required": true,
      "target": "body.repositoryOwner",
      "type": "string"
    },
    {
      "name": "repositoryName",
      "required": true,
      "target": "body.repositoryName",
      "type": "string"
    },
    {
      "name": "scheduleEnabled",
      "required": false,
      "target": "body.scheduleEnabled",
      "type": "boolean"
    },
    {
      "name": "refreshIntervalSeconds",
      "required": false,
      "target": "body.refreshIntervalSeconds",
      "type": "number"
    },
    {
      "name": "refreshNow",
      "required": false,
      "target": "body.refreshNow",
      "type": "boolean"
    }
  ],
  "method": "post",
  "path": "/external-issue-sources/{sourceKey}/bindings"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
