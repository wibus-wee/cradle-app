import { mkdir, readdir, rename, stat } from 'node:fs/promises'
import path from 'node:path'

import type { DownloadedArtifact, DownloadRequest } from '@cradle/download-center'
import type { ArchivePayloadSpec } from '@cradle/download-center/installation'
import {
  extractArchivePayload,
  VersionedInstallation,
} from '@cradle/download-center/installation'

import { AppError } from '../../errors/app-error'
import { toManagedResourceDownloadOwner } from '../managed-resources/service'
import type { OcrModelInstallationManifest } from './model-bundle'
import {
  defaultOcrModelRoot,
  LIGHT_OCR_BUNDLE_PATH_ENV,
  ocrModelPayloadPaths,
  parseOcrModelInstallationManifest,
  prepareOcrModelManagedPathForRemoval,
  resolveOcrModelBundle,
} from './model-bundle'
import type { ResolvedOcrModelRelease } from './model-release'
import { OCR_MODEL_MANIFEST, resolveOcrModelRelease } from './model-release'

const EXTRACT_TIMEOUT_MS = 60_000
const DOWNLOAD_MAX_BYTES = 512 * 1024 * 1024
const BUNDLE_MANIFEST_ENTRY = 'package/bundle/manifest.json'

export interface OcrModelRuntimeStatus {
  state: 'ready' | 'missing' | 'installing' | 'update-available' | 'error' | 'unavailable'
  source: 'configured' | 'managed' | 'bundled' | null
  version: string | null
  targetVersion: string
  managedInstalled: boolean
  installedSizeBytes: number | null
  downloadSizeBytes: number | null
  errorCode: string | null
}

export interface OcrModelDownloadCenter {
  execute: (request: DownloadRequest) => Promise<DownloadedArtifact>
  retry: (taskId: string, request: DownloadRequest) => Promise<DownloadedArtifact>
  release: (taskId: string) => Promise<unknown>
  findLatestRetryable: (
    owner: DownloadRequest['owner'],
    sourceId: string,
  ) => { taskId: string, updatedAt: string } | null
}

export interface OcrModelInstallationOptions {
  downloadCenter: OcrModelDownloadCenter
  rootDir?: string
  env?: NodeJS.ProcessEnv
  target?: ResolvedOcrModelRelease | null
  resolveBundle?: typeof resolveOcrModelBundle
  extractBundle?: (
    archivePath: string,
    target: ResolvedOcrModelRelease,
    destination: string,
  ) => Promise<string>
  prepareManagedPathForRemoval?: (bundlePath: string) => Promise<boolean>
  now?: () => Date
}

const createOcrError = (code: string, status: number, message: string) =>
  new AppError({ code: `image_ocr_model_${code}`, status, message })

async function directorySizeBytes(root: string): Promise<number | null> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true }).catch(() => null)
  if (!entries) {
    return null
  }
  let size = 0
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue
    }
    size += (await stat(path.join(entry.parentPath, entry.name)).catch(() => null))?.size ?? 0
  }
  return size
}

function npmBundleSpec(): ArchivePayloadSpec {
  return {
    classify: normalizedPath =>
      normalizedPath.startsWith('package/bundle/') ? 'payload' : 'ignore',
    isComplete: payloadPaths => payloadPaths.includes(BUNDLE_MANIFEST_ENTRY),
  }
}

export async function extractOcrModelBundle(
  archivePath: string,
  _target: ResolvedOcrModelRelease,
  destination: string,
): Promise<string> {
  const extractedPaths = await extractArchivePayload({
    archivePath,
    format: 'tar',
    destination,
    spec: npmBundleSpec(),
    createError: createOcrError,
  })
  const bundleManifest = extractedPaths.find(extracted => extracted.endsWith(path.join('bundle', 'manifest.json')))
  if (!bundleManifest) {
    throw new AppError({
      code: 'image_ocr_model_archive_invalid',
      status: 422,
      message: 'The OCR model package did not contain a bundle manifest.',
    })
  }
  return path.dirname(bundleManifest)
}

export class OcrModelInstallationService {
  private readonly downloadCenter: OcrModelDownloadCenter
  private readonly installation: VersionedInstallation<OcrModelInstallationManifest>
  private readonly env: NodeJS.ProcessEnv
  private readonly target: ResolvedOcrModelRelease | null
  private readonly resolveBundle: typeof resolveOcrModelBundle
  private readonly extractBundle: NonNullable<OcrModelInstallationOptions['extractBundle']>
  private readonly now: () => Date
  private lastErrorCode: string | null = null

  constructor(options: OcrModelInstallationOptions) {
    this.downloadCenter = options.downloadCenter
    this.env = options.env ?? process.env
    this.target = options.target === undefined ? resolveOcrModelRelease() : options.target
    this.resolveBundle = options.resolveBundle ?? resolveOcrModelBundle
    this.extractBundle = options.extractBundle ?? extractOcrModelBundle
    this.now = options.now ?? (() => new Date())
    this.installation = new VersionedInstallation({
      rootDir: options.rootDir ?? defaultOcrModelRoot(this.env),
      label: 'Light OCR model',
      parseManifest: parseOcrModelInstallationManifest,
      payloadPaths: ocrModelPayloadPaths,
      prepareForRemoval: options.prepareManagedPathForRemoval ?? prepareOcrModelManagedPathForRemoval,
      createError: createOcrError,
    })
  }

  private extractBundleWithTimeout(
    archivePath: string,
    target: ResolvedOcrModelRelease,
    destination: string,
  ): Promise<string> {
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new AppError({
          code: 'image_ocr_model_extract_timeout',
          status: 500,
          message: `OCR model package extraction did not finish within ${EXTRACT_TIMEOUT_MS}ms.`,
        }))
      }, EXTRACT_TIMEOUT_MS)
      timer.unref()
    })
    return Promise.race([
      this.extractBundle(archivePath, target, destination),
      timeout,
    ]).finally(() => {
      clearTimeout(timer)
    })
  }

  async boot(): Promise<void> {
    await this.installation.boot()
  }

  async status(ignoreInstallFlight = false): Promise<OcrModelRuntimeStatus> {
    const managedManifest = this.installation.current()
    const bundlePath = managedManifest
      ? this.installation.resolvePath(managedManifest.bundlePath)
      : null
    const installedSizeBytes = bundlePath ? await directorySizeBytes(bundlePath) : null
    if (!this.target) {
      return {
        state: 'unavailable',
        source: null,
        version: null,
        targetVersion: OCR_MODEL_MANIFEST.version,
        managedInstalled: !!managedManifest,
        installedSizeBytes,
        downloadSizeBytes: null,
        errorCode: 'image_ocr_model_target_unsupported',
      }
    }
    const downloadSizeBytes = this.target.unpackedSizeBytes
    if (this.installation.isInstalling() && !ignoreInstallFlight) {
      return {
        state: 'installing',
        source: managedManifest ? 'managed' : null,
        version: managedManifest?.version ?? null,
        targetVersion: this.target.version,
        managedInstalled: !!managedManifest,
        installedSizeBytes,
        downloadSizeBytes,
        errorCode: null,
      }
    }
    const bundle = this.resolveBundle({ env: this.env, rootDir: this.installation.rootDir })
    if (!bundle) {
      return {
        state: this.lastErrorCode ? 'error' : 'missing',
        source: this.env[LIGHT_OCR_BUNDLE_PATH_ENV]?.trim() ? 'configured' : null,
        version: null,
        targetVersion: this.target.version,
        managedInstalled: !!managedManifest,
        installedSizeBytes,
        downloadSizeBytes,
        errorCode: this.lastErrorCode ?? 'image_ocr_model_not_installed',
      }
    }
    return {
      state: this.lastErrorCode
        ? 'error'
        : bundle.managed && bundle.version !== this.target.version ? 'update-available' : 'ready',
      source: bundle.source,
      version: bundle.version,
      targetVersion: this.target.version,
      managedInstalled: !!managedManifest,
      installedSizeBytes,
      downloadSizeBytes,
      errorCode: this.lastErrorCode,
    }
  }

  install(): Promise<OcrModelRuntimeStatus> {
    if (!this.installation.accepting) {
      throw new AppError({ code: 'image_ocr_model_stopping', status: 503, message: 'Light OCR model installation is stopping.' })
    }
    if (this.env[LIGHT_OCR_BUNDLE_PATH_ENV]?.trim()) {
      throw new AppError({ code: 'image_ocr_model_override_active', status: 409, message: `A configured OCR model bundle override (${LIGHT_OCR_BUNDLE_PATH_ENV}) is active.` })
    }
    if (!this.target) {
      throw new AppError({ code: 'image_ocr_model_target_unsupported', status: 409, message: 'This platform does not have a supported Light OCR model.' })
    }
    const target = this.target
    return this.installation.install(async () => {
      try {
        return await this.installTarget(target)
      }
      catch (error) {
        this.lastErrorCode = error instanceof AppError ? error.code : 'image_ocr_model_install_failed'
        throw error
      }
    })
  }

  async uninstall(): Promise<OcrModelRuntimeStatus> {
    await this.installation.uninstall()
    this.lastErrorCode = null
    return await this.status()
  }

  async shutdown(): Promise<void> {
    await this.installation.shutdown()
  }

  private async installTarget(target: ResolvedOcrModelRelease): Promise<OcrModelRuntimeStatus> {
    const existing = this.installation.current()
    if (existing?.version === target.version && existing.sha512 === target.sha512) {
      return await this.status(true)
    }
    const owner = toManagedResourceDownloadOwner({
      key: { namespace: 'image-ocr', resourceType: 'model', resourceId: 'ppocrv6-small' },
      displayName: 'Light OCR model',
      description: 'PP-OCRv6 Small model bundle managed by Cradle.',
      kind: 'model',
      required: false,
    })
    const sourceId = `npm:${target.packageName}:${target.version}`
    const request: DownloadRequest = {
      owner,
      fileName: path.posix.basename(new URL(target.downloadUrl).pathname),
      sources: [{ id: sourceId, url: target.downloadUrl }],
      integrity: {
        checksum: { algorithm: 'sha512', value: target.sha512 },
      },
      maxBytes: DOWNLOAD_MAX_BYTES,
    }
    const retryable = this.downloadCenter.findLatestRetryable(owner, sourceId)
    const artifact = retryable
      ? await this.downloadCenter.retry(retryable.taskId, request)
      : await this.downloadCenter.execute(request)
    try {
      await this.installation.stageVersion({
        version: target.version,
        stage: async (versionStagingRoot, operationRoot) => {
          const extractedBundle = await this.extractBundleWithTimeout(
            artifact.filePath,
            target,
            path.join(operationRoot, 'extract'),
          )
          const stagedBundle = path.join(versionStagingRoot, 'bundle')
          await mkdir(versionStagingRoot, { recursive: true })
          await rename(extractedBundle, stagedBundle)
          return {
            schemaVersion: 1,
            version: target.version,
            bundleId: target.bundleId,
            bundlePath: path.join('versions', target.version, 'bundle'),
            sha512: target.sha512,
            installedAt: this.now().toISOString(),
          } satisfies OcrModelInstallationManifest
        },
      })
      this.lastErrorCode = null
      return await this.status(true)
    }
    finally {
      await this.downloadCenter.release(artifact.taskId).catch(() => undefined)
    }
  }
}
