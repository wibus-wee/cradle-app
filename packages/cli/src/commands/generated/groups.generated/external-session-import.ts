import type { Command } from 'commander'

import { register as registerExternalSessionImportImport } from '../external-session-import/import'
import { register as registerExternalSessionImportList } from '../external-session-import/list'
import { register as registerExternalSessionImportScan } from '../external-session-import/scan'
import { register as registerExternalSessionImportScanGet } from '../external-session-import/scan/get'
import { register as registerExternalSessionImportSync } from '../external-session-import/sync'

export function registerGeneratedCommands(program: Command): void {
  registerExternalSessionImportImport(program)
  registerExternalSessionImportList(program)
  registerExternalSessionImportScan(program)
  registerExternalSessionImportScanGet(program)
  registerExternalSessionImportSync(program)
}
