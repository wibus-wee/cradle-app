import { z } from 'zod'

import manifestJson from './ocr-model-manifest.json'

const modelManifestSchema = z.object({
  schemaVersion: z.literal(1),
  packageName: z.string().min(1),
  version: z.string().min(1),
  bundleId: z.string().min(1),
  registry: z.string().startsWith('https://'),
  tarball: z.string().startsWith('https://'),
  unpackedSizeBytes: z.number().int().positive(),
  sha512: z.string().regex(/^[a-f0-9]{128}$/),
})

export const OCR_MODEL_MANIFEST = modelManifestSchema.parse(manifestJson)

export interface ResolvedOcrModelRelease {
  packageName: string
  version: string
  bundleId: string
  downloadUrl: string
  unpackedSizeBytes: number
  sha512: string
}

/**
 * The PP-OCRv6 Small model package is platform-universal (the bundle carries
 * every backend subtree), so release resolution is unconditional.
 */
export function resolveOcrModelRelease(): ResolvedOcrModelRelease {
  return {
    packageName: OCR_MODEL_MANIFEST.packageName,
    version: OCR_MODEL_MANIFEST.version,
    bundleId: OCR_MODEL_MANIFEST.bundleId,
    downloadUrl: OCR_MODEL_MANIFEST.tarball,
    unpackedSizeBytes: OCR_MODEL_MANIFEST.unpackedSizeBytes,
    sha512: OCR_MODEL_MANIFEST.sha512,
  }
}
