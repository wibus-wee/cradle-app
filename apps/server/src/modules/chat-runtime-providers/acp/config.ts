import type { AcpChatConfig } from '../../../helpers/provider-config-schemas'
import type { AcpLaunchDistributionType } from '../../acp/launch-config'
import { resolveEffectiveLaunch } from '../../acp/launch-config'
import { getInstalled, readAgentAuthConfig } from '../../acp/service'
import { ProviderErrors, ProviderRuntimeError } from '../../chat-runtime/runtime-provider-types'
import { ACP_RUNTIME_KIND } from './metadata'

export type AcpDistributionType = AcpLaunchDistributionType
export type AcpRuntimeConfig = AcpChatConfig

interface AcpConnectionAuth {
  authMethodId: string | null
  configurationTarget?: { namespace: 'acp', resourceId: string }
}

export interface AcpLocalConnectionRecord extends AcpConnectionAuth {
  connectionType: 'stdio'
  distributionType: AcpDistributionType
  installPath: string | null
  cmd: string
  args: string
  env: string
}

export interface AcpRemoteConnectionRecord extends AcpConnectionAuth {
  connectionType: 'http' | 'websocket'
  endpointUrl: string
  headerSecretRefs: Record<string, string>
}

export type AcpConnectionRecord = AcpLocalConnectionRecord | AcpRemoteConnectionRecord

export interface ResolvedAcpConnection {
  record: AcpConnectionRecord
  connectionKey: string
}

export function readAcpDraftSessionId(configJson: string): string | null {
  const parsed = JSON.parse(configJson) as { acpDraftSessionId?: unknown }
  return typeof parsed.acpDraftSessionId === 'string' && parsed.acpDraftSessionId.length > 0
    ? parsed.acpDraftSessionId
    : null
}

export function buildAcpConnectionRecord(configJson: string): AcpConnectionRecord {
  const parsed = readTrustedAcpRuntimeConfig(configJson)

  return {
    connectionType: 'stdio',
    distributionType: parsed.distributionType,
    installPath: parsed.installPath,
    cmd: parsed.cmd,
    args: JSON.stringify(parsed.args),
    env: JSON.stringify(parsed.env),
    authMethodId: null,
  }
}

/**
 * Resolve the process launch record for an ACP connection from the merged session config.
 * When the config carries `acpAgentId`, the launch config comes from the installed agent's
 * `acp_agents` row (effective launch = base + overrides) and the connection keys one process
 * per installed agent; otherwise the legacy provider-target connection config drives the
 * launch under the caller's key.
 */
export function resolveAcpConnectionRecord(configJson: string, legacyConnectionKey: string): ResolvedAcpConnection {
  const acpAgentId = readAcpAgentId(configJson)
  if (!acpAgentId) {
    return { record: buildAcpConnectionRecord(configJson), connectionKey: legacyConnectionKey }
  }

  const installed = getInstalled(acpAgentId)
  if (!installed) {
    throw new ProviderRuntimeError(
      ProviderErrors.requestFailed(ACP_RUNTIME_KIND, 'resolve-connection', `ACP agent is not installed: ${acpAgentId}`),
    )
  }

  if (installed.status !== 'installed') {
    throw new ProviderRuntimeError(
      ProviderErrors.requestFailed(
        ACP_RUNTIME_KIND,
        'resolve-connection',
        `ACP agent is not ready (status=${installed.status}): ${acpAgentId}`,
      ),
    )
  }

  const auth = readAgentAuthConfig(acpAgentId)

  if (installed.connectionType === 'http' || installed.connectionType === 'websocket') {
    if (!installed.endpointUrl) {
      throw new ProviderRuntimeError(
        ProviderErrors.requestFailed(ACP_RUNTIME_KIND, 'resolve-connection', `ACP remote endpoint is missing: ${acpAgentId}`),
      )
    }
    return {
      record: {
        connectionType: installed.connectionType,
        endpointUrl: installed.endpointUrl,
        headerSecretRefs: JSON.parse(installed.remoteHeadersSecretRefsJson) as Record<string, string>,
        authMethodId: auth.methodId,
        configurationTarget: { namespace: 'acp', resourceId: acpAgentId },
      },
      connectionKey: `acp:${acpAgentId}`,
    }
  }

  const effective = resolveEffectiveLaunch(installed)

  return {
    record: {
      connectionType: 'stdio',
      distributionType: effective.distributionType,
      installPath: effective.installPath,
      cmd: effective.cmd,
      args: JSON.stringify(effective.args),
      env: JSON.stringify(effective.env),
      authMethodId: auth.methodId,
      configurationTarget: { namespace: 'acp', resourceId: acpAgentId },
    },
    connectionKey: `acp:${acpAgentId}`,
  }
}

function readAcpAgentId(configJson: string): string | null {
  const parsed = JSON.parse(configJson) as { acpAgentId?: unknown }
  return typeof parsed.acpAgentId === 'string' && parsed.acpAgentId.length > 0
    ? parsed.acpAgentId
    : null
}

function readTrustedAcpRuntimeConfig(configJson: string): AcpRuntimeConfig {
  const config = JSON.parse(configJson) as Partial<AcpRuntimeConfig> & { packageName?: string }
  return {
    distributionType: config.distributionType ?? 'npx',
    installPath: config.installPath ?? null,
    cmd: config.cmd ?? config.packageName ?? '',
    args: config.args ?? [],
    env: config.env ?? {},
  }
}
