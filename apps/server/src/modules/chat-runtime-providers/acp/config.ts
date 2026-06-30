import type { AcpChatConfig } from '../../../helpers/provider-config-schemas'

export type AcpDistributionType = 'binary' | 'npx' | 'uvx'
export type AcpRuntimeConfig = AcpChatConfig

export interface AcpConnectionRecord {
  distributionType: AcpDistributionType
  installPath: string | null
  cmd: string
  args: string
  env: string
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
