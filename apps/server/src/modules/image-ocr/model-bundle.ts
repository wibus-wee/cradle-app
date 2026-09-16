import { existsSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import path from 'node:path'

import {
  isPathInside,
  readCurrentInstallation,
  resolveManagedPath,
} from '@cradle/download-center/installation'

export const LIGHT_OCR_BUNDLE_PATH_ENV = 'CRADLE_LIGHT_OCR_BUNDLE_PATH'
const MODEL_PACKAGE = '@arcships/light-ocr-model-ppocrv6-small'
const FACADE_PACKAGE = '@arcships/light-ocr'
const INSTALLATION_SCHEMA_VERSION = 1

export type OcrModelBundleSource = 'configured' | 'managed' | 'bundled'

export interface ResolvedOcrModelBundle {
  source: OcrModelBundleSource
  /**
   * Concrete bundle directory (contains manifest.json). Null for `bundled`:
   * the light-ocr facade resolves its own model package, so `bundlePath`
   * stays unset and the facade keeps its native error attribution.
   */
  path: string | null
  version: string | null
  managed: boolean
}

export interface OcrModelInstallationManifest {
  schemaVersion: 1
  version: string
  bundleId: string
  bundlePath: string
  sha512: string
  installedAt: string
}

export function resolveImageOcrRuntimeHome(input: {
  env?: NodeJS.ProcessEnv
  homeDir?: string
} = {}): string {
  const env = input.env ?? process.env
  const dataDir = env.CRADLE_DATA_DIR?.trim()
  if (dataDir) {
    return path.join(dataDir, 'runtimes', 'image-ocr')
  }

  const dbPath = env.CRADLE_DB_PATH?.trim()
  if (dbPath) {
    return path.join(path.dirname(dbPath), 'runtimes', 'image-ocr')
  }

  return path.join(input.homeDir ?? homedir(), '.cradle', 'runtimes', 'image-ocr')
}

export function defaultOcrModelRoot(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveImageOcrRuntimeHome({ env }), 'ppocrv6-small')
}

export function parseOcrModelInstallationManifest(raw: unknown): OcrModelInstallationManifest | null {
  if (typeof raw !== 'object' || raw === null) {
    return null
  }
  const manifest = raw as OcrModelInstallationManifest
  return manifest.schemaVersion === INSTALLATION_SCHEMA_VERSION
    && typeof manifest.version === 'string'
    && manifest.version.length > 0
    && typeof manifest.bundleId === 'string'
    && manifest.bundleId.length > 0
    && typeof manifest.bundlePath === 'string'
    && typeof manifest.sha512 === 'string'
    && /^[a-f0-9]{128}$/.test(manifest.sha512)
    && typeof manifest.installedAt === 'string'
    ? manifest
    : null
}

export function ocrModelPayloadPaths(manifest: OcrModelInstallationManifest) {
  return [{ path: manifest.bundlePath, kind: 'directory' as const }]
}

export function readOcrModelInstallation(rootDir: string): OcrModelInstallationManifest | null {
  return readCurrentInstallation({
    rootDir,
    parseManifest: parseOcrModelInstallationManifest,
    payloadPaths: ocrModelPayloadPaths,
  })
}

/**
 * Mirror of the facade's own model lookup: anchored at the installed
 * `@arcships/light-ocr` entry so pnpm's virtual-store layout resolves the
 * sibling model package. Returns the bundle directory, or null when the
 * model package is absent (packaged builds prune it).
 */
export function resolveBundledOcrBundlePath(): string | null {
  try {
    const localRequire = createRequire(import.meta.url)
    const facadeEntryPath = localRequire.resolve(FACADE_PACKAGE)
    const facadeRequire = createRequire(facadeEntryPath)
    const bundleManifestPath = facadeRequire.resolve(`${MODEL_PACKAGE}/bundle/manifest.json`)
    if (existsSync(bundleManifestPath) && statSync(bundleManifestPath).isFile()) {
      return path.dirname(bundleManifestPath)
    }
    return null
  }
  catch {
    return null
  }
}

/**
 * Resolve which model bundle `createEngine` should use:
 * `CRADLE_LIGHT_OCR_BUNDLE_PATH` -> managed install -> bundled model package.
 * Null when nothing is available.
 */
export function resolveOcrModelBundle(input: {
  env?: NodeJS.ProcessEnv
  rootDir?: string
  bundledPath?: string | null
} = {}): ResolvedOcrModelBundle | null {
  const env = input.env ?? process.env
  const configured = env[LIGHT_OCR_BUNDLE_PATH_ENV]?.trim()
  if (configured) {
    return { source: 'configured', path: configured, version: null, managed: false }
  }
  const rootDir = input.rootDir ?? defaultOcrModelRoot(env)
  const managed = readOcrModelInstallation(rootDir)
  if (managed) {
    return {
      source: 'managed',
      path: resolveManagedPath(rootDir, managed.bundlePath),
      version: managed.version,
      managed: true,
    }
  }
  const bundled = input.bundledPath === undefined ? resolveBundledOcrBundlePath() : input.bundledPath
  if (bundled) {
    return { source: 'bundled', path: null, version: null, managed: false }
  }
  return null
}

const engineLeases = new Map<string, () => Promise<void>>()

/**
 * Lease the managed bundle an engine was created against. `close` releases
 * the lease after the engine finishes closing.
 */
export function registerOcrEngineLease(bundlePath: string, close: () => Promise<void>): void {
  engineLeases.set(path.resolve(bundlePath), close)
}

export function releaseOcrEngineLease(bundlePath: string): void {
  engineLeases.delete(path.resolve(bundlePath))
}

/**
 * `prepareForRemoval` hook for the versioned installation: close any engine
 * leasing a bundle inside the removed path, then allow deletion.
 */
export async function prepareOcrModelManagedPathForRemoval(removedPath: string): Promise<boolean> {
  const resolved = path.resolve(removedPath)
  const closers: Array<() => Promise<void>> = []
  for (const [leasedPath, close] of engineLeases) {
    if (isPathInside(resolved, leasedPath) || isPathInside(leasedPath, resolved)) {
      engineLeases.delete(leasedPath)
      closers.push(close)
    }
  }
  for (const close of closers) {
    try {
      await close()
    }
    catch {
      return false
    }
  }
  return true
}
