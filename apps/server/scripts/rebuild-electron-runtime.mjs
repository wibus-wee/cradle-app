#!/usr/bin/env node
/**
 * Output: Rebuilds bundled server native dependencies for Cradle desktop's Electron runtime.
 * Input: apps/server/dist/desktop-runtime plus the target Electron version from CRADLE_ELECTRON_VERSION or apps/desktop/package.json.
 * Position: Server-owned desktop runtime artifact preparation; desktop packaging consumes the artifact without mutating it.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const serverRoot = resolve(scriptDir, '..')
const repoRoot = resolve(serverRoot, '../..')
const serverRuntimeDir = resolve(serverRoot, 'dist/desktop-runtime')
const serverRuntimeNodeModules = join(serverRuntimeDir, 'node_modules')
const electronVersion = process.env.CRADLE_ELECTRON_VERSION ?? readDesktopElectronVersion()
const targetArch
  = process.env.CRADLE_ELECTRON_REBUILD_ARCH ?? process.env.npm_config_arch ?? process.arch

if (!existsSync(join(serverRuntimeDir, 'package.json')) || !existsSync(serverRuntimeNodeModules)) {
  throw new Error(
    `Server desktop runtime not found at ${serverRuntimeDir}. `
    + 'Run pnpm --filter @cradle/server build:desktop-runtime to prepare it.',
  )
}

const result = spawnPnpmSync(
  [
    'exec',
    'electron-rebuild',
    '--version',
    electronVersion,
    '--module-dir',
    serverRuntimeDir,
    '--arch',
    targetArch,
    '--force',
    '--build-from-source',
  ],
  {
    cwd: serverRoot,
    stdio: 'inherit',
  },
)

if (result.error) {
  throw result.error
}

if (result.status !== 0) {
  process.exit(result.status ?? 1)
}

writeElectronRuntimeTarget()
pruneElectronRuntimeArtifact()

process.exit(0)

function readDesktopElectronVersion() {
  const desktopPackageJsonPath = resolve(repoRoot, 'apps/desktop/package.json')
  const packageJson = JSON.parse(readFileSync(desktopPackageJsonPath, 'utf8'))
  const versionRange = packageJson.devDependencies?.electron ?? packageJson.dependencies?.electron

  if (typeof versionRange !== 'string') {
    throw new TypeError(`Cannot find desktop Electron version in ${desktopPackageJsonPath}`)
  }

  const version = versionRange.match(/\d+\.\d+\.\d+(?:[-+][0-9A-Z.-]+)?/i)?.[0]
  if (!version) {
    throw new Error(`Cannot parse desktop Electron version "${versionRange}" from ${desktopPackageJsonPath}`)
  }
  return version
}

function spawnPnpmSync(args, options) {
  if (process.platform !== 'win32') {
    return spawnSync('pnpm', args, options)
  }

  const npmExecPath = process.env.npm_execpath
  if (npmExecPath) {
    return spawnSync(process.execPath, [npmExecPath, ...args], options)
  }

  return spawnSync('pnpm', args, { ...options, shell: true })
}

function writeElectronRuntimeTarget() {
  const manifestPath = join(serverRuntimeDir, 'desktop-runtime.json')
  const manifest = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, 'utf8'))
    : {}

  writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        ...manifest,
        electron: {
          version: electronVersion,
          arch: targetArch,
          platform: process.platform,
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
}

function pruneElectronRuntimeArtifact() {
  const pruned = []

  removeMatchingFiles(serverRuntimeNodeModules, [
    /\.d\.ts$/,
    /\.map$/,
    /\.md$/i,
    /\.pdb$/i,
  ], pruned)

  pruneNodePty(pruned)
  pruneBetterSqlite3(pruned)
  pruneGptTokenizer(pruned)
  pruneTypeScriptPeer(pruned)
  pruneCradleDbDuplicateMigrations(pruned)

  writeElectronRuntimePruneManifest(pruned)
}

function removeMatchingFiles(root, patterns, pruned) {
  if (!existsSync(root)) {
    return
  }

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const entryPath = join(root, entry.name)
    if (entry.isDirectory()) {
      removeMatchingFiles(entryPath, patterns, pruned)
      continue
    }

    if (entry.isFile() && patterns.some(pattern => pattern.test(entry.name))) {
      removePath(entryPath, pruned)
    }
  }
}

function pruneNodePty(pruned) {
  const packageDir = findPnpmPackageDir('node-pty@')
  if (!packageDir) {
    return
  }

  const prebuildsDir = join(packageDir, 'node_modules/node-pty/prebuilds')
  const targetPrebuild = `${process.platform}-${targetArch}`
  if (existsSync(prebuildsDir)) {
    for (const entry of readdirSync(prebuildsDir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== targetPrebuild) {
        removePath(join(prebuildsDir, entry.name), pruned)
      }
    }
  }
}

function pruneBetterSqlite3(pruned) {
  const packageDir = findPnpmPackageDir('better-sqlite3@')
  if (!packageDir) {
    return
  }

  const betterSqliteDir = join(packageDir, 'node_modules/better-sqlite3')
  for (const relativePath of [
    'bin',
    'deps',
    'src',
    'build/Makefile',
    'build/better_sqlite3.target.mk',
    'build/binding.Makefile',
    'build/config.gypi',
    'build/deps',
    'build/gyp-mac-tool',
    'build/test_extension.target.mk',
    'build/Release/.deps',
    'build/Release/obj',
    'build/Release/obj.target',
    'build/Release/sqlite3.a',
    'build/Release/test_extension.node',
  ]) {
    removePath(join(betterSqliteDir, relativePath), pruned)
  }
}

function pruneTypeScriptPeer(pruned) {
  const packageDir = findPnpmPackageDir('typescript@')
  if (!packageDir) {
    return
  }

  removePath(join(packageDir, 'node_modules/typescript'), pruned)
}

function pruneCradleDbDuplicateMigrations(pruned) {
  const packageDir = findPnpmPackageDir('@cradle+db@')
  if (!packageDir) {
    return
  }

  removePath(join(packageDir, 'node_modules/@cradle/db/drizzle'), pruned)
}

function pruneGptTokenizer(pruned) {
  const packageDir = findPnpmPackageDir('gpt-tokenizer@')
  if (!packageDir) {
    return
  }

  const tokenizerDir = join(packageDir, 'node_modules/gpt-tokenizer')
  for (const relativePath of [
    'dist',
    'src',
  ]) {
    removePath(join(tokenizerDir, relativePath), pruned)
  }
}

function findPnpmPackageDir(prefix) {
  const pnpmDir = join(serverRuntimeNodeModules, '.pnpm')
  if (!existsSync(pnpmDir)) {
    return null
  }

  const packageEntry = readdirSync(pnpmDir).find(entry => entry.startsWith(prefix))
  return packageEntry ? join(pnpmDir, packageEntry) : null
}

function removePath(pathToRemove, pruned) {
  if (!existsSync(pathToRemove)) {
    return
  }

  rmSync(pathToRemove, { recursive: true, force: true })
  pruned.push(pathToRemove)
}

function writeElectronRuntimePruneManifest(pruned) {
  const manifestPath = join(serverRuntimeDir, 'desktop-runtime.json')
  const manifest = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, 'utf8'))
    : {}

  writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        ...manifest,
        pruning: {
          removedCount: pruned.length,
          updatedAt: new Date().toISOString(),
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
}
