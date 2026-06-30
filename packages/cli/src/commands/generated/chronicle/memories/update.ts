import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "name": "memoryId",
      "required": true,
      "target": "path.memoryId",
      "type": "string"
    }
  ],
  "command": [
    "chronicle",
    "memories",
    "update"
  ],
  "description": "Update a Chronicle memory",
  "flags": [
    {
      "name": "content",
      "required": false,
      "target": "body.content",
      "type": "string"
    },
    {
      "name": "metadata",
      "required": false,
      "target": "body.metadata",
      "type": "json"
    },
    {
      "name": "sourceSnapshotPaths",
      "required": false,
      "target": "body.sourceSnapshotPaths",
      "type": "string[]"
    },
    {
      "name": "sourceFramePaths",
      "required": false,
      "target": "body.sourceFramePaths",
      "type": "string[]"
    }
  ],
  "method": "patch",
  "path": "/chronicle/memories/{memoryId}"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
