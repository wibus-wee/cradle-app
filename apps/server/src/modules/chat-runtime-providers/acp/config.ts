import type { AcpChatConfig } from '../../../helpers/provider-config-schemas'
import { getInstalled } from '../../acp/service'
import { ProviderErrors, ProviderRuntimeError } from '../../chat-runtime/runtime-provider-types'
import { ACP_RUNTIME_KIND } from './metadata'

export type AcpDistributionType = 'binary' | 'npx' | 'uvx'
export type AcpRuntimeConfig = AcpChatConfig

export interface AcpConnectionRecord {
  distributionType: AcpDistributionType
  installPath: string | null
  cmd: string
  args: string
  env: string
}

export interface ResolvedAcpConnection {
  record: AcpConnectionRecord
  connectionKey: string
}

export function buildAcpConnectionRecord(configJson: string): AcpConnectionRecord {
  const parsed = readTrustedAcpRuntimeConfig(configJson)

  return {
    distributionType: parsed.distributionType,
    installPath: parsed.installPath,
    cmd: parsed.cmd,
    args: JSON.stringify(parsed.args),
    env: JSON.stringify(parsed.env),
  }
}

/**
 * Resolve the process launch record for an ACP connection from the merged session config.
 * When the config carries `acpAgentId`, the launch config comes from the installed agent's
 * `acp_agents` row and the connection keys one process per installed agent; otherwise the
 * legacy provider-target connection config drives the launch under the caller's key.
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

  return {
    record: {
      distributionType: installed.distributionType as AcpDistributionType,
      installPath: installed.installPath,
      cmd: installed.cmd ?? '',
      args: installed.args,
      env: installed.env,
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
