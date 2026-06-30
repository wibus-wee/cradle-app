import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "name": "bindingId",
      "required": true,
      "target": "path.bindingId",
      "type": "string"
    }
  ],
  "command": [
    "external-issue-source",
    "binding",
    "update"
  ],
  "description": "Update an external issue source binding",
  "flags": [
    {
      "name": "enabled",
      "required": false,
      "target": "body.enabled",
      "type": "boolean"
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
    }
  ],
  "method": "patch",
  "path": "/external-issue-sources/bindings/{bindingId}"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
