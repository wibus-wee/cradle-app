import { File } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

import type { Asset } from '@cradle/db'
import { assets, workspaces } from '@cradle/db'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'

import { AppError } from '../../errors/app-error'
import { currentUnixSeconds } from '../../helpers/time'
import { db, getServerConfig } from '../../infra'

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024
const MAX_IMAGE_SIDE = 2048
const MAX_INPUT_PIXELS = 50_000_000
const WEBP_QUALITY = 86

const MEDIA_TYPE_BY_FORMAT = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
} as const

const EXTENSION_BY_MEDIA_TYPE = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const

type SupportedSharpFormat = keyof typeof MEDIA_TYPE_BY_FORMAT
type SupportedMediaType = keyof typeof EXTENSION_BY_MEDIA_TYPE

export interface CreateAssetInput {
  workspaceId?: string | null
  file: File
}

export interface AssetView {
  id: string
  workspaceId: string | null
  filename: string
  mediaType: string
  byteSize: number
  width: number | null
  height: number | null
  sha256: string
  storagePath: string
  url: string
  markdownUrl: string
  createdAt: number
}

export interface AssetContent {
  path: string
  mediaType: string
  byteSize: number
}

interface PreparedAssetFile {
  bytes: Buffer
  mediaType: SupportedMediaType
  width: number | null
  height: number | null
  sha256: string
  extension: string
}

function resolveDataRoot(): string {
  const config = getServerConfig()
  return resolve(config.dataDir ?? dirname(config.dbPath))
}

function resolveStoragePath(storagePath: string): string {
  const dataRoot = resolveDataRoot()
  const fullPath = resolve(dataRoot, storagePath)
  const rel = relative(dataRoot, fullPath)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new AppError({
      code: 'asset_storage_path_invalid',
      status: 500,
      message: 'Asset storage path is outside the Cradle data directory',
      details: { storagePath },
    })
  }
  return fullPath
}

function assetStoragePath(input: { workspaceId: string | null, assetId: string, extension: string }): string {
  const ownerPath = input.workspaceId ? `workspaces/${input.workspaceId}` : 'global'
  return `assets/${ownerPath}/${input.assetId}.${input.extension}`
}

function assertSafeStorageSegment(value: string, field: string): void {
  if (!value || value.includes('/') || value.includes('\\') || value.includes('..')) {
    throw new AppError({
      code: 'asset_storage_segment_invalid',
      status: 400,
      message: `${field} is invalid for asset storage`,
      details: { field, value },
    })
  }
}

function normalizeWorkspaceId(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed || null
}

function requireWorkspace(workspaceId: string): void {
  const workspace = db().select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, workspaceId)).get()
  if (!workspace) {
    throw new AppError({
      code: 'asset_workspace_not_found',
      status: 404,
      message: 'Workspace not found',
      details: { workspaceId },
    })
  }
}

function contentRoute(id: string): string {
  return `/assets/${encodeURIComponent(id)}/content`
}

function markdownUrl(id: string): string {
  return `cradle-asset://${encodeURIComponent(id)}`
}

export function assetContentRoute(id: string): string {
  return contentRoute(id)
}

function toAssetView(row: Asset): AssetView {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    filename: row.filename,
    mediaType: row.mediaType,
    byteSize: row.byteSize,
    width: row.width,
    height: row.height,
    sha256: row.sha256,
    storagePath: row.storagePath,
    url: contentRoute(row.id),
    markdownUrl: markdownUrl(row.id),
    createdAt: row.createdAt,
  }
}

function readSupportedFormat(format: string | undefined): SupportedSharpFormat {
  if (format === 'jpeg' || format === 'png' || format === 'webp') {
    return format
  }
  throw new AppError({
    code: 'asset_image_type_unsupported',
    status: 415,
    message: 'Only JPEG, PNG, and WebP images are supported',
    details: { format: format ?? null },
  })
}

function extensionForMediaType(mediaType: SupportedMediaType): string {
  return EXTENSION_BY_MEDIA_TYPE[mediaType]
}

function hashBytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function prepareImage(input: Buffer): Promise<PreparedAssetFile> {
  const image = sharp(input, {
    failOn: 'error',
    limitInputPixels: MAX_INPUT_PIXELS,
  }).rotate()
  const metadata = await image.metadata()
  const format = readSupportedFormat(metadata.format)
  const originalMediaType = MEDIA_TYPE_BY_FORMAT[format]

  const resized = image.clone().resize({
    width: MAX_IMAGE_SIDE,
    height: MAX_IMAGE_SIDE,
    fit: 'inside',
    withoutEnlargement: true,
  })
  const webp = await resized.clone().webp({ quality: WEBP_QUALITY }).toBuffer()
  const normalizedOriginal = await encodeOriginalFormat(resized.clone(), format)
  const selectedBytes = webp.length <= normalizedOriginal.length ? webp : normalizedOriginal
  const selectedMediaType: SupportedMediaType = webp.length <= normalizedOriginal.length ? 'image/webp' : originalMediaType
  const selectedMetadata = await sharp(selectedBytes, {
    failOn: 'error',
    limitInputPixels: MAX_INPUT_PIXELS,
  }).metadata()

  return {
    bytes: selectedBytes,
    mediaType: selectedMediaType,
    width: selectedMetadata.width ?? null,
    height: selectedMetadata.height ?? null,
    sha256: hashBytes(selectedBytes),
    extension: extensionForMediaType(selectedMediaType),
  }
}

async function encodeOriginalFormat(image: sharp.Sharp, format: SupportedSharpFormat): Promise<Buffer> {
  if (format === 'jpeg') {
    return image.jpeg({ quality: 90 }).toBuffer()
  }
  if (format === 'png') {
    return image.png().toBuffer()
  }
  return image.webp({ quality: 90 }).toBuffer()
}

function readSafeFilename(file: File): string {
  const trimmed = file.name.trim()
  return trimmed || 'image'
}

export async function createAsset(input: CreateAssetInput): Promise<AssetView> {
  const workspaceId = normalizeWorkspaceId(input.workspaceId)
  if (workspaceId) {
    assertSafeStorageSegment(workspaceId, 'workspaceId')
    requireWorkspace(workspaceId)
  }
  if (!(input.file instanceof File)) {
    throw new AppError({
      code: 'asset_file_required',
      status: 400,
      message: 'Asset upload requires a file',
    })
  }
  if (input.file.size <= 0) {
    throw new AppError({
      code: 'asset_file_empty',
      status: 400,
      message: 'Asset upload file is empty',
    })
  }
  if (input.file.size > MAX_UPLOAD_BYTES) {
    throw new AppError({
      code: 'asset_file_too_large',
      status: 413,
      message: 'Asset upload file is too large',
      details: { maxBytes: MAX_UPLOAD_BYTES, byteSize: input.file.size },
    })
  }

  const uploadBytes = Buffer.from(await input.file.arrayBuffer())
  const prepared = await prepareImage(uploadBytes)
  const assetId = randomUUID()
  const storagePath = assetStoragePath({
    workspaceId,
    assetId,
    extension: prepared.extension,
  })
  const fullPath = resolveStoragePath(storagePath)

  await mkdir(dirname(fullPath), { recursive: true })
  await writeFile(fullPath, prepared.bytes, { flag: 'wx' })

  try {
    const row = db().insert(assets).values({
      id: assetId,
      workspaceId,
      filename: readSafeFilename(input.file),
      mediaType: prepared.mediaType,
      byteSize: prepared.bytes.length,
      width: prepared.width,
      height: prepared.height,
      sha256: prepared.sha256,
      storagePath,
      createdAt: currentUnixSeconds(),
    }).returning().get()
    return toAssetView(row)
  }
  catch (error) {
    await rm(fullPath, { force: true })
    throw error
  }
}

export function getAsset(id: string): AssetView {
  const row = db().select().from(assets).where(eq(assets.id, id)).get()
  if (!row) {
    throw new AppError({
      code: 'asset_not_found',
      status: 404,
      message: 'Asset not found',
      details: { assetId: id },
    })
  }
  return toAssetView(row)
}

export function getAssetContent(id: string): AssetContent {
  const asset = getAsset(id)
  return {
    path: resolveStoragePath(asset.storagePath),
    mediaType: asset.mediaType,
    byteSize: asset.byteSize,
  }
}

export async function readAssetBytes(id: string): Promise<{ bytes: Buffer, mediaType: string, byteSize: number }> {
  const content = getAssetContent(id)
  return {
    bytes: await readFile(content.path),
    mediaType: content.mediaType,
    byteSize: content.byteSize,
  }
}

export async function deleteAsset(id: string): Promise<void> {
  const row = db().select().from(assets).where(eq(assets.id, id)).get()
  if (!row) {
    throw new AppError({
      code: 'asset_not_found',
      status: 404,
      message: 'Asset not found',
      details: { assetId: id },
    })
  }

  await rm(resolveStoragePath(row.storagePath), { force: true })
  db().delete(assets).where(eq(assets.id, id)).run()
}
