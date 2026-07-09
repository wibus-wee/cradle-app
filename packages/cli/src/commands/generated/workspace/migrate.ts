import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "description": "Accepts a workspace name or id.",
      "name": "workspaceId",
      "required": true,
      "target": "path.workspaceId",
      "type": "string",
      "flagName": "workspace",
      "resolver": "workspace",
      "resolverAmbient": false
    }
  ],
  "command": [
    "workspace",
    "migrate"
  ],
  "description": "Migrate all entities from one workspace to another",
  "flags": [
    {
      "name": "targetWorkspaceId",
      "required": true,
      "target": "body.targetWorkspaceId",
      "type": "string"
    },
    {
      "description": "Which entity types to migrate. Defaults to all three.",
      "name": "entities",
      "required": false,
      "target": "body.entities",
      "type": "string[]"
    },
    {
      "description": "Map source status name → target status name. Unmapped statuses fall back to target default.",
      "name": "statusMappings",
      "required": false,
      "target": "body.statusMappings",
      "type": "json"
    },
    {
      "description": "Map source milestone title → target milestone title. Unmapped milestones are cleared.",
      "name": "milestoneMappings",
      "required": false,
      "target": "body.milestoneMappings",
      "type": "json"
    },
    {
      "description": "Preview the migration without making changes.",
      "name": "dryRun",
      "required": false,
      "target": "body.dryRun",
      "type": "boolean"
    }
  ],
  "method": "post",
  "path": "/workspaces/{workspaceId}/migrate"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
