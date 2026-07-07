import { relayHostEnrollments } from '@cradle/db'
import type { PluginSourceDescriptor } from '@cradle/plugin-sdk'

import { db } from '../infra'
import { MARKETPLACE_INSTALL_RECEIPT_FILE } from './install-receipt'
import { calculatePluginPackageChecksum } from './package-checksum'
import { readPluginTrustGrant } from './trust-grants'
import { validateMarketplacePackageIntegrity } from './validation'

interface PluginTrustEvaluationInput {
  pluginName: string
  source: PluginSourceDescriptor
  relayHostExposed?: boolean
}

function isMarketplaceTrustedSource(source: PluginSourceDescriptor): boolean {
  return source.provenance?.kind === 'marketplace-install' && source.grantedPermissions !== undefined
}

export function isExternalLocalCodeSource(source: PluginSourceDescriptor): boolean {
  return source.kind === 'externalLocal' && !isMarketplaceTrustedSource(source)
}

export function readRelayHostExposure(): boolean {
  return db()
    .select({ id: relayHostEnrollments.id })
    .from(relayHostEnrollments)
    .limit(1)
    .get() !== undefined
}

export async function evaluatePluginSourceTrust(
  input: PluginTrustEvaluationInput,
): Promise<PluginSourceDescriptor> {
  const checksum = await calculatePluginPackageChecksum(input.source.packageDir)
  if (input.source.provenance?.packageChecksum) {
    validateMarketplacePackageIntegrity({
      actualChecksum: checksum,
      expectedChecksum: input.source.provenance.packageChecksum,
      pluginName: input.pluginName,
    })
  }

  if (input.source.kind !== 'externalLocal') {
    return {
      ...input.source,
      checksum,
      trusted: true,
      reason: input.source.reason ?? `Discovered under ${input.source.packageDir}.`,
    }
  }

  if (isMarketplaceTrustedSource(input.source)) {
    return {
      ...input.source,
      checksum,
      trusted: true,
      reason: input.source.provenance?.packageChecksum
        ? 'Marketplace package checksum matches the install receipt.'
        : `Marketplace install receipt has no package checksum; ${MARKETPLACE_INSTALL_RECEIPT_FILE} permissions were still limited to the Cradle-owned marketplace directory.`,
    }
  }

  if (input.relayHostExposed ?? readRelayHostExposure()) {
    return {
      ...input.source,
      checksum,
      trusted: false,
      reason: 'External local plugins are blocked while relay host enrollments expose this server.',
    }
  }

  const grant = readPluginTrustGrant(input.pluginName, checksum)
  if (grant) {
    return {
      ...input.source,
      checksum,
      trusted: true,
      reason: 'External local plugin matches a stored operator trust grant.',
    }
  }

  return {
    ...input.source,
    checksum,
    trusted: false,
    reason: `External local plugins require an operator trust grant for checksum ${checksum}.`,
  }
}
