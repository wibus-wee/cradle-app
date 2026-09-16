import { randomUUID } from 'node:crypto'
import { accessSync, constants, existsSync, readFileSync, statSync } from 'node:fs'
import { mkdir, open, readdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'

/**
 * Error suffixes produced by the versioned-installation machinery. Owners map
 * them onto their own error contract through `createError` (e.g. a server
 * module prefixes them onto `AppError` codes), so the package never dictates
 * error shape.
 */
export type VersionedInstallErrorCode
  = | 'archive_invalid'
    | 'install_conflict'
    | 'install_in_progress'
    | 'in_use'
    | 'not_installed'
    | 'stopping'

export type InstallationErrorFactory = (
  code: VersionedInstallErrorCode,
  status: number,
  message: string,
) => Error

/** A payload entry declared by an installation manifest, relative to rootDir. */
export interface InstallationPayloadRef {
  path: string
  kind: 'file' | 'directory'
}

/** Minimum shape the installation layout needs from an owner manifest. */
export interface VersionedManifest {
  version: string
}

export interface VersionedInstallationHooks<TManifest extends VersionedManifest> {
  rootDir: string
  /** Human label interpolated into failure messages (e.g. 'OpenCode runtime'). */
  label: string
  /**
   * Structurally validate a parsed installation.json payload. Return null when
   * the payload is not a valid manifest — payload existence on disk is checked
   * separately through `payloadPaths`.
   */
  parseManifest: (raw: unknown) => TManifest | null
  /**
   * Payload entries the manifest claims to own, relative to rootDir. Every
   * entry must resolve inside rootDir and exist with the declared kind for the
   * manifest to be considered current.
   */
  payloadPaths: (manifest: TManifest) => readonly InstallationPayloadRef[]
  /**
   * Lease drain invoked before removing any installed payload path (current
   * and orphaned versions alike). Return false to refuse removal.
   */
  prepareForRemoval?: (absolutePath: string) => Promise<boolean>
  createError: InstallationErrorFactory
}

export function isPathInside(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative.length === 0 || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

/** Resolve a manifest-declared relative path inside rootDir; null when unsafe. */
export function resolveManagedPath(rootDir: string, relativePath: string): string | null {
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes('\0')) {
    return null
  }
  const target = path.resolve(rootDir, relativePath)
  return isPathInside(rootDir, target) ? target : null
}

function payloadExists(rootDir: string, ref: InstallationPayloadRef): boolean {
  const target = resolveManagedPath(rootDir, ref.path)
  if (!target) {
    return false
  }
  try {
    const stats = statSync(target)
    return ref.kind === 'directory' ? stats.isDirectory() : stats.isFile()
  }
  catch {
    return false
  }
}

/**
 * Read and validate the `current.json` installation pointer: the manifest must
 * parse, every declared payload entry must exist, and the manifest recorded
 * inside `versions/<version>/installation.json` must be byte-identical.
 */
export function readCurrentInstallation<TManifest extends VersionedManifest>(input: {
  rootDir: string
  parseManifest: (raw: unknown) => TManifest | null
  payloadPaths: (manifest: TManifest) => readonly InstallationPayloadRef[]
}): TManifest | null {
  try {
    const currentPath = path.join(input.rootDir, 'current.json')
    const raw: unknown = JSON.parse(readFileSync(currentPath, 'utf8'))
    const manifest = input.parseManifest(raw)
    if (!manifest || !input.payloadPaths(manifest).every(ref => payloadExists(input.rootDir, ref))) {
      return null
    }
    const versionManifestPath = path.join(input.rootDir, 'versions', manifest.version, 'installation.json')
    const versionRaw: unknown = JSON.parse(readFileSync(versionManifestPath, 'utf8'))
    return JSON.stringify(versionRaw) === JSON.stringify(raw) ? manifest : null
  }
  catch {
    return null
  }
}

export function findExecutableOnPath(
  command: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): string | null {
  const hasSeparator = command.includes('/') || command.includes('\\')
  const candidates = hasSeparator
    ? [path.resolve(command)]
    : (env.PATH ?? '').split(path.delimiter).filter(Boolean).flatMap((directory) => {
        if (platform !== 'win32') {
          return [path.join(directory, command)]
        }
        const extensions = (env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
        return path.extname(command)
          ? [path.join(directory, command)]
          : extensions.map(extension => path.join(directory, `${command}${extension.toLowerCase()}`))
      })
  for (const candidate of candidates) {
    try {
      accessSync(candidate, platform === 'win32' ? constants.F_OK : constants.X_OK)
      if (statSync(candidate).isFile()) {
        return path.resolve(candidate)
      }
    }
    catch {
      continue
    }
  }
  return null
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`
  const handle = await open(temporaryPath, 'wx')
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await handle.sync()
  }
  finally {
    await handle.close()
  }
  await rename(temporaryPath, filePath)
}

/**
 * Owns the `rootDir/{versions/<version>/,staging/,current.json}` layout for a
 * managed payload: immutable version directories, an atomic current pointer,
 * boot cleanup, serialized install flights, and lease-gated removal.
 *
 * Owners keep their own release manifests, target resolution, executable
 * precedence, and version probing — this class only owns on-disk lifecycle.
 */
export class VersionedInstallation<TManifest extends VersionedManifest> {
  readonly rootDir: string
  private readonly label: string
  private readonly parseManifest: (raw: unknown) => TManifest | null
  private readonly payloadPaths: (manifest: TManifest) => readonly InstallationPayloadRef[]
  private readonly prepareForRemoval: (absolutePath: string) => Promise<boolean>
  private readonly createError: InstallationErrorFactory
  private installFlight: Promise<unknown> | null = null
  private acceptingCommands = true

  constructor(options: VersionedInstallationHooks<TManifest>) {
    this.rootDir = options.rootDir
    this.label = options.label
    this.parseManifest = options.parseManifest
    this.payloadPaths = options.payloadPaths
    this.prepareForRemoval = options.prepareForRemoval ?? (async () => true)
    this.createError = options.createError
  }

  private fail(code: VersionedInstallErrorCode, status: number, message: string): never {
    throw this.createError(code, status, message)
  }

  get accepting(): boolean {
    return this.acceptingCommands
  }

  isInstalling(): boolean {
    return this.installFlight !== null
  }

  /** The currently pointed-at valid manifest, or null. */
  current(): TManifest | null {
    return readCurrentInstallation({
      rootDir: this.rootDir,
      parseManifest: this.parseManifest,
      payloadPaths: this.payloadPaths,
    })
  }

  resolvePath(relativePath: string): string | null {
    return resolveManagedPath(this.rootDir, relativePath)
  }

  /**
   * Recreate the layout, drop an invalid current pointer, and remove every
   * version directory the pointer does not reference.
   */
  async boot(): Promise<void> {
    await mkdir(path.join(this.rootDir, 'versions'), { recursive: true })
    await rm(path.join(this.rootDir, 'staging'), { recursive: true, force: true })
    await mkdir(path.join(this.rootDir, 'staging'), { recursive: true })
    if (!this.current()) {
      await rm(path.join(this.rootDir, 'current.json'), { force: true })
    }
    const current = this.current()
    const versions = await readdir(path.join(this.rootDir, 'versions'), { withFileTypes: true })
    await Promise.all(versions
      .filter(entry => entry.isDirectory() && entry.name !== current?.version)
      .map(entry => rm(path.join(this.rootDir, 'versions', entry.name), { recursive: true, force: true })))
  }

  /**
   * Serialize install work: concurrent callers share the in-flight promise,
   * and work is refused once shutdown begins. Owner preconditions (override
   * guards, target checks) run before this call.
   */
  install<T>(work: () => Promise<T>): Promise<T> {
    if (!this.acceptingCommands) {
      this.fail('stopping', 503, `${this.label} installation is stopping.`)
    }
    if (this.installFlight) {
      return this.installFlight as Promise<T>
    }
    const flight = work().finally(() => {
      if (this.installFlight === flight) {
        this.installFlight = null
      }
    })
    this.installFlight = flight
    return flight
  }

  /**
   * Stage a new version into `staging/<uuid>/<version>` via `stage`, persist
   * its `installation.json`, then atomically promote it into `versions/` and
   * point `current.json` at it. The scratch directory is always removed.
   */
  async stageVersion(input: {
    version: string
    stage: (versionStagingRoot: string, operationRoot: string) => Promise<TManifest>
  }): Promise<TManifest> {
    const operationRoot = path.join(this.rootDir, 'staging', randomUUID())
    const versionStagingRoot = path.join(operationRoot, input.version)
    try {
      const manifest = await input.stage(versionStagingRoot, operationRoot)
      await writeJsonAtomic(path.join(versionStagingRoot, 'installation.json'), manifest)
      const versionRoot = path.join(this.rootDir, 'versions', input.version)
      if (existsSync(versionRoot)) {
        this.fail(
          'install_conflict',
          409,
          `A ${this.label} version directory already exists without a valid installation pointer.`,
        )
      }
      await rename(versionStagingRoot, versionRoot)
      await writeJsonAtomic(path.join(this.rootDir, 'current.json'), manifest)
      return manifest
    }
    finally {
      await rm(operationRoot, { recursive: true, force: true })
    }
  }

  /**
   * Payload absolute paths across every valid installed version — the current
   * version plus orphaned versions whose payloads may still be leased.
   */
  async listInstalledPayloadPaths(): Promise<string[]> {
    const paths = new Set<string>()
    const collect = (manifest: TManifest | null): void => {
      if (!manifest) {
        return
      }
      for (const ref of this.payloadPaths(manifest)) {
        const target = resolveManagedPath(this.rootDir, ref.path)
        if (target) {
          paths.add(target)
        }
      }
    }
    collect(this.current())
    let versionEntries
    try {
      versionEntries = await readdir(path.join(this.rootDir, 'versions'), { withFileTypes: true })
    }
    catch {
      return [...paths]
    }
    for (const entry of versionEntries) {
      if (!entry.isDirectory()) {
        continue
      }
      try {
        const raw: unknown = JSON.parse(readFileSync(
          path.join(this.rootDir, 'versions', entry.name, 'installation.json'),
          'utf8',
        ))
        const manifest = this.parseManifest(raw)
        if (!manifest || manifest.version !== entry.name) {
          continue
        }
        for (const ref of this.payloadPaths(manifest)) {
          const target = resolveManagedPath(this.rootDir, ref.path)
          if (target && payloadExists(this.rootDir, ref)) {
            paths.add(target)
          }
        }
      }
      catch {
        // Corrupt orphaned versions were never resolvable and cannot own a lease.
      }
    }
    return [...paths]
  }

  /** Remove every managed version after draining leases on all payload paths. */
  async uninstall(): Promise<void> {
    if (!this.acceptingCommands) {
      this.fail('stopping', 503, `${this.label} installation is stopping.`)
    }
    if (this.installFlight) {
      this.fail('install_in_progress', 409, `${this.label} installation is in progress.`)
    }
    if (!this.current()) {
      this.fail('not_installed', 409, `No managed ${this.label} is installed.`)
    }
    for (const payloadPath of await this.listInstalledPayloadPaths()) {
      if (!await this.prepareForRemoval(payloadPath)) {
        this.fail('in_use', 409, `${this.label} is in use by an active session.`)
      }
    }
    await rm(path.join(this.rootDir, 'current.json'), { force: true })
    await rm(path.join(this.rootDir, 'versions'), { recursive: true, force: true })
    await mkdir(path.join(this.rootDir, 'versions'), { recursive: true })
  }

  async shutdown(): Promise<void> {
    this.acceptingCommands = false
    await this.installFlight?.catch(() => undefined)
  }
}
