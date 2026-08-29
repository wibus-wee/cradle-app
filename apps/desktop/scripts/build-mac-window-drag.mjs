#!/usr/bin/env node
/** Builds and stages the in-process AppKit window-drag addon. */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const desktopRoot = join(__dirname, '..')
const addonRoot = join(desktopRoot, 'native', 'macos', 'window-drag')
const builtAddonPath = join(addonRoot, 'build', 'Release', 'window_drag.node')
const stagedAddonDir = join(desktopRoot, 'dist', 'main', 'native')
const stagedAddonPath = join(stagedAddonDir, 'window-drag.node')
const stageOnly = process.argv.includes('--stage')

function log(message) {
  console.log(`[desktop] mac-window-drag: ${message}`)
}

function stageBuiltAddon() {
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

if (process.platform !== 'darwin') {
  log('skipped (non-darwin host)')
  process.exit(0)
}

const require = createRequire(import.meta.url)
const nodeGypCli = require.resolve('node-gyp/bin/node-gyp.js')
const pkg = JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8'))
const electronVersion = String(pkg.devDependencies?.electron ?? '').replace(/^[\^~]/, '')
const args = [
  nodeGypCli,
  'rebuild',
  '--runtime=electron',
  `--target=${electronVersion}`,
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
