/* Reads Cradle Marketplace install receipts from plugin package directories. */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import type { PluginSourceProvenance } from '@cradle/plugin-sdk'
import { z } from 'zod'

export const MARKETPLACE_INSTALL_RECEIPT_FILE = 'cradle-marketplace-install.json'

const PluginInstallReceiptSchema = z.object({
  schemaVersion: z.literal(1),
  installedAt: z.string(),
  mode: z.enum(['alreadyAvailable', 'downloaded']),
  source: z.string(),
  repository: z.string(),
  path: z.string(),
  packageName: z.string(),
  version: z.string(),
  channel: z.string(),
  ref: z.string(),
  originalUrl: z.string().optional(),
  grantedPermissions: z.array(z.string().trim().min(1)).default([]),
})
const PluginInstallReceiptJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(PluginInstallReceiptSchema)

export async function readPluginInstallProvenance(
  packageDir: string,
  expected?: { packageName: string, version: string },
): Promise<PluginSourceProvenance | undefined> {
  const receiptPath = resolve(packageDir, MARKETPLACE_INSTALL_RECEIPT_FILE)
  let raw: string
  try {
    raw = await readFile(receiptPath, 'utf8')
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }
    throw error
  }

  const receipt = PluginInstallReceiptJsonSchema.parse(raw)
  if (
    expected
    && (receipt.packageName !== expected.packageName || receipt.version !== expected.version)
  ) {
    return undefined
  }
  return {
    kind: 'marketplace-install',
    installedAt: receipt.installedAt,
    mode: receipt.mode,
    source: receipt.source,
    repository: receipt.repository,
    path: receipt.path,
    packageName: receipt.packageName,
    version: receipt.version,
    channel: receipt.channel,
    ref: receipt.ref,
    originalUrl: receipt.originalUrl,
    grantedPermissions: receipt.grantedPermissions,
  }
}
