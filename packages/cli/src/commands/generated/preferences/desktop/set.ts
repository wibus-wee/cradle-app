import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "preferences",
    "desktop",
    "set"
  ],
  "description": "Set desktop preferences",
  "flags": [
    {
      "name": "requireDoubleCommandQToQuit",
      "required": true,
      "target": "body.requireDoubleCommandQToQuit",
      "type": "boolean"
    },
    {
      "name": "appshotHotkeyEnabled",
      "required": true,
      "target": "body.appshotHotkeyEnabled",
      "type": "boolean"
    },
    {
      "name": "appshotHotkeyTrigger",
      "required": true,
      "target": "body.appshotHotkeyTrigger",
      "type": "string",
      "values": [
        "DoubleCommand",
        "DoubleOption",
        "DoubleShift"
      ]
    },
    {
      "name": "autoCheckForUpdates",
      "required": true,
      "target": "body.autoCheckForUpdates",
      "type": "boolean"
    },
    {
      "name": "autoDownloadUpdates",
      "required": true,
      "target": "body.autoDownloadUpdates",
      "type": "boolean"
    },
    {
      "name": "lastSeenChangelogVersion",
      "required": true,
      "target": "body.lastSeenChangelogVersion",
      "type": "string"
    }
  ],
  "method": "put",
  "path": "/preferences/desktop"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
