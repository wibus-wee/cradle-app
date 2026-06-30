import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "name": "snapshotId",
      "required": true,
      "target": "path.snapshotId",
      "type": "string"
    }
  ],
  "command": [
    "chronicle",
    "activity-snapshots",
    "ocr"
  ],
  "description": "Get Chronicle activity snapshot OCR metadata",
  "flags": [],
  "method": "get",
  "path": "/chronicle/activity-snapshots/{snapshotId}/ocr"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
