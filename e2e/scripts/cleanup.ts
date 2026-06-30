/**
 * Cleans up E2E test artefacts:
 * - Deletes the Electron app's userData directory for the `e2e` environment.
 *
 * Run with: npx tsx e2e/scripts/cleanup.ts
 */
import { existsSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const platform = process.platform
const appName = 'cradle-e2e' // set via app.setPath('userData', ...) in E2E mode

let userDataDir: string
if (platform === 'darwin') {
  userDataDir = join(homedir(), 'Library', 'Application Support', appName)
}
else if (platform === 'win32') {
  userDataDir = join(process.env.APPDATA ?? homedir(), appName)
}
else {
  userDataDir = join(homedir(), '.config', appName)
}

if (existsSync(userDataDir)) {
  rmSync(userDataDir, { recursive: true, force: true })
  console.log(`Removed: ${userDataDir}`)
}
else {
  console.log(`Nothing to clean (not found): ${userDataDir}`)
}
