import { z } from 'zod'

import { getServerUrl } from '~/lib/electron'

export const AssetSchema = z.object({
  id: z.string(),
  workspaceId: z.string().nullable(),
  filename: z.string(),
  mediaType: z.string(),
  byteSize: z.number(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  sha256: z.string(),
  storagePath: z.string(),
  url: z.string(),
  markdownUrl: z.string(),
  createdAt: z.number(),
})

export type CradleAsset = z.infer<typeof AssetSchema>

export interface UploadAssetInput {
  file: File
  workspaceId?: string | null
}

export async function uploadAsset(input: UploadAssetInput): Promise<CradleAsset> {
  const body = new FormData()
  body.set('file', input.file)
  if (input.workspaceId) {
    body.set('workspaceId', input.workspaceId)
  }

  const response = await fetch(new URL('/assets', getServerUrl()).toString(), {
    method: 'POST',
    body,
  })
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || `Asset upload failed with HTTP ${response.status}`)
  }

  return AssetSchema.parse(await response.json())
}
