#!/usr/bin/env node
/**
 * Rebuild electron-sparkle-updater's native addon against the local Electron ABI.
 * No-op on non-darwin hosts (Sparkle is macOS-only).
 */
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const desktopRoot = join(__dirname, '..')

if (process.platform !== 'darwin') {
  console.log('[desktop] rebuild-sparkle: skipped (non-darwin)')
  process.exit(0)
}

const require = createRequire(import.meta.url)

function resolveElectronVersion() {
  const fromEnv = process.env.npm_config_target || process.env.ELECTRON_VERSION
  if (fromEnv) {
    return fromEnv
  }
  try {
    const pkg = JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8'))
    const version = pkg.devDependencies?.electron || pkg.dependencies?.electron
    if (typeof version === 'string') {
      return version.replace(/^[\^~]/, '')
    }
  }
  catch {
    // fall through
  }
  return undefined
}

function resolveCli() {
  try {
    return require.resolve('electron-sparkle-updater/bin/electron-sparkle-updater.js')
  }
  catch {
    try {
      const pkgRoot = dirname(require.resolve('electron-sparkle-updater/package.json'))
      return join(pkgRoot, 'bin', 'electron-sparkle-updater.js')
    }
    catch {
      return null
    }
  }
}

const cli = resolveCli()
if (!cli || !existsSync(cli)) {
  console.warn('[desktop] rebuild-sparkle: electron-sparkle-updater CLI not found; skipping')
  process.exit(0)
}

const electronVersion = resolveElectronVersion()
const arch = process.env.CRADLE_ELECTRON_REBUILD_ARCH || process.arch
const args = [cli, 'rebuild', '--arch', arch]
if (electronVersion) {
  args.push('--electron-version', electronVersion)
}
if (process.env.CRADLE_SPARKLE_FORCE_FETCH === '1') {
  args.push('--force-fetch')
}

console.log(`[desktop] rebuild-sparkle: node ${args.join(' ')}`)
const result = spawnSync(process.execPath, args, {
  cwd: desktopRoot,
  stdio: 'inherit',
  env: process.env,
})

if (result.status !== 0) {
  process.exit(result.status ?? 1)
}
