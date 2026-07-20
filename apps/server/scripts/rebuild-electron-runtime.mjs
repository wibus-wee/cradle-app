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
  pruneClaudeAgentSdkPlatformBinaries(pruned)
  pruneAnthropicSdkSources(pruned)

  writeElectronRuntimePruneManifest(pruned)
}

function removeMatchingFiles(root, patterns, pruned) {
  if (!existsSync(root)) {
    return
  }

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const entryPath = join(root, entry.name)
    if (entry.isDirectory()) {
      // Skip nested node_modules traversal noise; we still walk package trees via
      // resolvePackageRoots. Nested modules are visited when their own root is listed.
      if (entry.name === 'node_modules' || entry.name === '.bin') {
        continue
      }
      removeMatchingFiles(entryPath, patterns, pruned)
      continue
    }

    if (entry.isFile() && patterns.some(pattern => pattern.test(entry.name))) {
      removePath(entryPath, pruned)
    }
  }
}

/**
 * Resolve a package directory under either hoisted node_modules or .pnpm virtual store.
 * prepare-desktop-runtime uses --config.node-linker=hoisted, so most packages live at
 * node_modules/<name> rather than node_modules/.pnpm/<name@ver>/node_modules/<name>.
 */
function resolvePackageRoots(packageName) {
  const roots = []
  const topLevel = join(serverRuntimeNodeModules, ...packageName.split('/'))
  if (existsSync(topLevel)) {
    roots.push(topLevel)
  }

  const pnpmDir = join(serverRuntimeNodeModules, '.pnpm')
  if (existsSync(pnpmDir)) {
    const escaped = packageName.startsWith('@')
      ? packageName.replace('/', '+')
      : packageName
    for (const entry of readdirSync(pnpmDir)) {
      if (!entry.startsWith(`${escaped}@`) && !entry.startsWith(`${packageName}@`)) {
        continue
      }
      const nested = join(pnpmDir, entry, 'node_modules', ...packageName.split('/'))
      if (existsSync(nested)) {
        roots.push(nested)
      }
    }
  }

  return roots
}

function pruneNodePty(pruned) {
  for (const packageDir of resolvePackageRoots('node-pty')) {
    const prebuildsDir = join(packageDir, 'prebuilds')
    const targetPrebuild = `${process.platform}-${targetArch}`
    if (existsSync(prebuildsDir)) {
      for (const entry of readdirSync(prebuildsDir, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name !== targetPrebuild) {
          removePath(join(prebuildsDir, entry.name), pruned)
        }
      }
    }
  }
}

function pruneBetterSqlite3(pruned) {
  for (const betterSqliteDir of resolvePackageRoots('better-sqlite3')) {
    // Keep only the runtime .node + JS loader. Build intermediates and SQLite
    // amalgamation sources routinely add ~25MB and are never loaded at runtime.
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
      'build/Release/obj/gen',
      'build/Release/sqlite3.a',
      'build/Release/test_extension.node',
      'binding.gyp',
    ]) {
      removePath(join(betterSqliteDir, relativePath), pruned)
    }
  }
}

function pruneTypeScriptPeer(pruned) {
  for (const packageDir of resolvePackageRoots('typescript')) {
    removePath(packageDir, pruned)
  }
}

function pruneCradleDbDuplicateMigrations(pruned) {
  for (const packageDir of resolvePackageRoots('@cradle/db')) {
    removePath(join(packageDir, 'drizzle'), pruned)
  }
}

function pruneGptTokenizer(pruned) {
  for (const tokenizerDir of resolvePackageRoots('gpt-tokenizer')) {
    for (const relativePath of [
      'dist',
      'src',
    ]) {
      removePath(join(tokenizerDir, relativePath), pruned)
    }
  }
}

/**
 * Claude Agent SDK optionalDependencies ship a ~230MB native `claude` CLI per
 * platform. Slim desktop packages omit them (Download Center later); full offline
 * bundles keep only the host platform package.
 */
function pruneClaudeAgentSdkPlatformBinaries(pruned) {
  const bundleAgents = ['1', 'true', 'yes', 'on'].includes(
    (process.env.CRADLE_DESKTOP_BUNDLE_AGENT_BINARIES ?? '').trim().toLowerCase(),
  )
  const hostPackage = `@anthropic-ai/claude-agent-sdk-${process.platform}-${targetArch}`
  const platformPackages = [
    '@anthropic-ai/claude-agent-sdk-darwin-arm64',
    '@anthropic-ai/claude-agent-sdk-darwin-x64',
    '@anthropic-ai/claude-agent-sdk-win32-x64',
    '@anthropic-ai/claude-agent-sdk-win32-arm64',
    '@anthropic-ai/claude-agent-sdk-linux-x64',
    '@anthropic-ai/claude-agent-sdk-linux-arm64',
    '@anthropic-ai/claude-agent-sdk-linux-x64-musl',
    '@anthropic-ai/claude-agent-sdk-linux-arm64-musl',
  ]

  for (const packageName of platformPackages) {
    if (bundleAgents && packageName === hostPackage) {
      continue
    }
    for (const root of resolvePackageRoots(packageName)) {
      removePath(root, pruned)
    }
    // Top-level scoped dir may remain empty after package removal
    removePath(join(serverRuntimeNodeModules, ...packageName.split('/')), pruned)
  }
}

/** Anthropic JS SDK ships src/ + .d.ts trees that are never executed at runtime. */
function pruneAnthropicSdkSources(pruned) {
  for (const packageDir of resolvePackageRoots('@anthropic-ai/sdk')) {
    for (const relativePath of ['src', '.github']) {
      removePath(join(packageDir, relativePath), pruned)
    }
  }
  for (const packageDir of resolvePackageRoots('@anthropic-ai/claude-agent-sdk')) {
    // Keep only the JS loaders; type defs / browser bundle are not needed in Electron server.
    for (const relativePath of [
      'browser-sdk.js',
      'browser-sdk.d.ts',
      'sdk.d.ts',
      'bridge.d.ts',
      'agentSdkTypes.d.ts',
      'sdk-tools.d.ts',
      'extractFromBunfs.d.ts',
    ]) {
      removePath(join(packageDir, relativePath), pruned)
    }
  }
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
