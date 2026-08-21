#!/usr/bin/env node
/**
 * Build the Windows caption-button native addon against the local Electron ABI.
 *
 * - default: run node-gyp rebuild (win32 hosts only; no-op elsewhere) and stage
 *   the produced .node into dist/main/native when that directory exists.
 * - --stage: only stage a previously built .node into dist/main/native.
 */
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const desktopRoot = join(__dirname, '..')
const addonRoot = join(desktopRoot, 'native', 'windows', 'caption-buttons')
const builtAddonPath = join(addonRoot, 'build', 'Release', 'caption_buttons.node')
const stagedAddonDir = join(desktopRoot, 'dist', 'main', 'native')
const stagedAddonPath = join(stagedAddonDir, 'caption-buttons.node')

const stageOnly = process.argv.includes('--stage')
const isWin32 = process.platform === 'win32'

function log(message) {
  console.log(`[desktop] win-caption: ${message}`)
}

function stageBuiltAddon() {
  if (!isWin32 && !existsSync(builtAddonPath)) {
    return
  }
  if (!existsSync(builtAddonPath)) {
    log(`built addon not found at ${builtAddonPath}; skipping staging`)
    return
  }
  mkdirSync(stagedAddonDir, { recursive: true })
  copyFileSync(builtAddonPath, stagedAddonPath)
  log(`staged addon to ${stagedAddonPath}`)
}

if (stageOnly) {
  stageBuiltAddon()
  process.exit(0)
}

if (!isWin32) {
  log('skipped (non-win32 host)')
  process.exit(0)
}

const require = createRequire(import.meta.url)
let nodeGypCli
try {
  nodeGypCli = require.resolve('node-gyp/bin/node-gyp.js')
}
catch {
  log('node-gyp not installed; skipping')
  process.exit(0)
}

const pkg = JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8'))
const electronVersion = String(pkg.devDependencies?.electron ?? '').replace(/^[\^~]/, '')
if (!electronVersion) {
  log('electron version not found in package.json; skipping')
  process.exit(1)
}

mkdirSync(join(desktopRoot, 'dist', 'main'), { recursive: true })
const args = [
  nodeGypCli,
  'rebuild',
  '--runtime=electron',
  '--target=' + electronVersion,
  '--dist-url=https://electronjs.org/headers',
]
log(`node ${args.slice(1).join(' ')}`)
const result = spawnSync(process.execPath, args, {
  cwd: addonRoot,
  stdio: 'inherit',
  env: process.env,
})

stageBuiltAddon()
process.exit(result.status ?? 1)
