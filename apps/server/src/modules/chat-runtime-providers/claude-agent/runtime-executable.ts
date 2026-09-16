import { existsSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import {
  findExecutableOnPath,
  isPathInside,
  readCurrentInstallation,
  resolveManagedPath,
} from '@cradle/download-center/installation'

import { AppError } from '../../../errors/app-error'
import { resolveClaudeAgentSdkConfigDir } from './runtime-context'
import { detectClaudeCodeLinuxLibc } from './runtime-release'

const INSTALLATION_SCHEMA_VERSION = 1
const VERSION_PATTERN = /\b\d+\.\d+\.\d+(?:[-+][0-9A-Z.-]+)?\b/i
const SDK_PACKAGE = '@anthropic-ai/claude-agent-sdk'
const SDK_PLATFORM_PREFIX = `${SDK_PACKAGE}-`
export const CLAUDE_CODE_PATH_ENV = 'CRADLE_CLAUDE_CODE_PATH'

export type ClaudeExecutableSource = 'configured' | 'managed' | 'sdk-bundled' | 'path'

export interface ResolvedClaudeAgentExecutable {
  source: ClaudeExecutableSource
  /**
   * Concrete executable path. Null for `sdk-bundled`: the SDK resolves its own
   * optional platform package, so `pathToClaudeCodeExecutable` stays unset and
   * the SDK keeps its native error attribution.
   */
  path: string | null
  version: string | null
  managed: boolean
}

export interface ClaudeCodeInstallationManifest {
  schemaVersion: 1
  version: string
  targetKey: string
  executablePath: string
  sha512: string
  installedAt: string
}

export function defaultClaudeRuntimeRoot(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveClaudeAgentSdkConfigDir({ env }), 'managed')
}

export function parseClaudeCodeInstallationManifest(raw: unknown): ClaudeCodeInstallationManifest | null {
  if (typeof raw !== 'object' || raw === null) {
    return null
  }
  const manifest = raw as ClaudeCodeInstallationManifest
  return manifest.schemaVersion === INSTALLATION_SCHEMA_VERSION
    && typeof manifest.version === 'string'
    && VERSION_PATTERN.test(manifest.version)
    && typeof manifest.targetKey === 'string'
    && manifest.targetKey.length > 0
    && typeof manifest.executablePath === 'string'
    && typeof manifest.sha512 === 'string'
    && /^[a-f0-9]{128}$/.test(manifest.sha512)
    && typeof manifest.installedAt === 'string'
    ? manifest
    : null
}

export function claudeCodePayloadPaths(manifest: ClaudeCodeInstallationManifest) {
  return [{ path: manifest.executablePath, kind: 'file' as const }]
}

export function readClaudeCodeInstallation(rootDir: string): ClaudeCodeInstallationManifest | null {
  return readCurrentInstallation({
    rootDir,
    parseManifest: parseClaudeCodeInstallationManifest,
    payloadPaths: claudeCodePayloadPaths,
  })
}

/** Absolute managed `claude` executable path, or null when not installed. */
export function resolveClaudeManagedExecutablePath(input: {
  env?: NodeJS.ProcessEnv
  rootDir?: string
} = {}): string | null {
  const rootDir = input.rootDir ?? defaultClaudeRuntimeRoot(input.env)
  const manifest = readClaudeCodeInstallation(rootDir)
  return manifest ? resolveManagedPath(rootDir, manifest.executablePath) : null
}

function sdkPlatformPackageCandidates(
  platform: NodeJS.Platform,
  arch: string,
  libc: 'glibc' | 'musl' | null,
): string[] {
  if (platform === 'linux') {
    return libc === 'musl'
      ? [`${SDK_PLATFORM_PREFIX}linux-${arch}-musl`, `${SDK_PLATFORM_PREFIX}linux-${arch}`]
      : [`${SDK_PLATFORM_PREFIX}linux-${arch}`, `${SDK_PLATFORM_PREFIX}linux-${arch}-musl`]
  }
  if (platform === 'darwin' || platform === 'win32') {
    return [`${SDK_PLATFORM_PREFIX}${platform}-${arch}`]
  }
  return []
}

/**
 * Mirror of the SDK's own binary lookup (`createRequire(sdk.mjs)` +
 * `<platform package>/claude`). Anchoring the require at the installed SDK
 * entry point keeps pnpm's `.pnpm` virtual-store layout working.
 */
export function resolveSdkBundledClaudePath(input: {
  platform?: NodeJS.Platform
  arch?: string
  libc?: 'glibc' | 'musl' | null
} = {}): string | null {
  const platform = input.platform ?? process.platform
  const arch = input.arch ?? process.arch
  const libc = input.libc === undefined && platform === 'linux' ? detectClaudeCodeLinuxLibc() : input.libc
  const executableName = platform === 'win32' ? 'claude.exe' : 'claude'
  try {
    const localRequire = createRequire(import.meta.url)
    const sdkEntryPath = localRequire.resolve(SDK_PACKAGE)
    const sdkRequire = createRequire(sdkEntryPath)
    for (const packageName of sdkPlatformPackageCandidates(platform, arch, libc ?? null)) {
      try {
        const candidate = sdkRequire.resolve(`${packageName}/${executableName}`)
        if (existsSync(candidate) && statSync(candidate).isFile()) {
          return candidate
        }
      }
      catch {
        continue
      }
    }
    return null
  }
  catch {
    return null
  }
}

/**
 * Resolve which `claude` binary a query would use:
 * `CRADLE_CLAUDE_CODE_PATH` → managed install → SDK-bundled platform package →
 * PATH `claude`. Null when nothing is available.
 */
export function resolveClaudeAgentExecutable(input: {
  env?: NodeJS.ProcessEnv
  rootDir?: string
  platform?: NodeJS.Platform
  arch?: string
  libc?: 'glibc' | 'musl' | null
  sdkBundledPath?: string | null
} = {}): ResolvedClaudeAgentExecutable | null {
  const env = input.env ?? process.env
  const platform = input.platform ?? process.platform
  const configured = env[CLAUDE_CODE_PATH_ENV]?.trim()
  if (configured) {
    return { source: 'configured', path: configured, version: null, managed: false }
  }
  const rootDir = input.rootDir ?? defaultClaudeRuntimeRoot(env)
  const managed = readClaudeCodeInstallation(rootDir)
  if (managed) {
    return {
      source: 'managed',
      path: resolveManagedPath(rootDir, managed.executablePath)!,
      version: managed.version,
      managed: true,
    }
  }
  const sdkBundled = input.sdkBundledPath === undefined
    ? resolveSdkBundledClaudePath({ platform, arch: input.arch, libc: input.libc })
    : input.sdkBundledPath
  if (sdkBundled) {
    return { source: 'sdk-bundled', path: null, version: null, managed: false }
  }
  const onPath = findExecutableOnPath(platform === 'win32' ? 'claude.exe' : 'claude', env, platform)
  if (onPath) {
    return { source: 'path', path: onPath, version: null, managed: false }
  }
  return null
}

export function requireClaudeAgentExecutable(
  input: Parameters<typeof resolveClaudeAgentExecutable>[0] = {},
): ResolvedClaudeAgentExecutable {
  const executable = resolveClaudeAgentExecutable(input)
  if (!executable) {
    throw new AppError({
      code: 'claude_agent_runtime_not_installed',
      status: 409,
      message: 'Claude Code runtime is not installed. Install it from Resources.',
    })
  }
  return executable
}

/**
 * Apply executable resolution onto SDK query options: sets
 * `pathToClaudeCodeExecutable` for configured/managed/PATH sources and leaves
 * it unset for the SDK-bundled package. Throws `claude_agent_runtime_not_installed`
 * before any spawn when nothing resolves.
 */
export function applyClaudeAgentExecutableToQueryOptions(
  options: { pathToClaudeCodeExecutable?: string },
  input: Parameters<typeof resolveClaudeAgentExecutable>[0] = {},
): ResolvedClaudeAgentExecutable {
  const executable = requireClaudeAgentExecutable(input)
  if (executable.path) {
    options.pathToClaudeCodeExecutable = executable.path
  }
  return executable
}

const managedExecutableLeases = new Map<string, number>()

export function isManagedClaudeExecutablePath(
  executablePath: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!executablePath) {
    return false
  }
  const rootDir = path.resolve(defaultClaudeRuntimeRoot(env))
  const resolved = path.resolve(executablePath)
  return resolved !== rootDir && isPathInside(rootDir, resolved)
}

/**
 * Lease-gate for managed `claude` binaries: a query spawned from a managed
 * path holds a lease until its SDK `close()` runs (every Cradle call site
 * funnels through `closeClaudeQuery` in a finally). Leases survive version
 * swaps because they key on the absolute versioned path.
 */
export function trackClaudeManagedQuery<T extends { close?: () => void }>(
  activeQuery: T,
  options: { pathToClaudeCodeExecutable?: string },
): T {
  const executablePath = options.pathToClaudeCodeExecutable
  if (!executablePath || !isManagedClaudeExecutablePath(executablePath)) {
    return activeQuery
  }
  const key = path.resolve(executablePath)
  managedExecutableLeases.set(key, (managedExecutableLeases.get(key) ?? 0) + 1)
  let released = false
  const release = (): void => {
    if (released) {
      return
    }
    released = true
    managedExecutableLeases.set(key, Math.max(0, (managedExecutableLeases.get(key) ?? 1) - 1))
  }
  const originalClose = activeQuery.close
  activeQuery.close = function (this: unknown, ...args: []) {
    release()
    return originalClose?.apply(this, args)
  } as T['close']
  return activeQuery
}

/** `prepareForRemoval` hook: refuse while a live query leases the binary. */
export function prepareClaudeManagedPathForRemoval(binaryPath: string): Promise<boolean> {
  return Promise.resolve((managedExecutableLeases.get(path.resolve(binaryPath)) ?? 0) === 0)
}

/** Test-only: read the live lease count for a managed path. */
export function readClaudeManagedExecutableLeaseCount(executablePath: string): number {
  return managedExecutableLeases.get(path.resolve(executablePath)) ?? 0
}
