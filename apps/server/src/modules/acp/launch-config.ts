import { isAbsolute, join, normalize, sep } from 'node:path'

export type AcpLaunchDistributionType = 'binary' | 'npx' | 'uvx' | 'command'

export interface AcpLaunchRow {
  distributionType: string
  installPath: string | null
  cmd: string | null
  args: string | null
  env: string | null
  overrideCmd?: string | null
  overrideArgs?: string | null
  overrideEnv?: string | null
}

export interface EffectiveLaunch {
  distributionType: AcpLaunchDistributionType
  installPath: string | null
  cmd: string
  args: string[]
  env: Record<string, string>
}

export function parseArgsJson(text: string | null | undefined): string[] {
  if (text == null || text === '') {
    return []
  }
  try {
    const parsed: unknown = JSON.parse(text)
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.map(item => String(item))
  }
  catch {
    return []
  }
}

export function parseEnvJson(text: string | null | undefined): Record<string, string> {
  if (text == null || text === '') {
    return {}
  }
  try {
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }
    const result: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') {
        result[key] = value
      }
      else if (value != null) {
        result[key] = String(value)
      }
    }
    return result
  }
  catch {
    return {}
  }
}

/**
 * Merge base launch columns with nullable override_* columns.
 * - cmd/args: override replaces when non-null (including empty args array)
 * - env: shallow merge when overrideEnv is non-null (override keys win)
 * - distributionType / installPath: always from base
 */
export function resolveEffectiveLaunch(row: AcpLaunchRow): EffectiveLaunch {
  const distributionType = (row.distributionType || 'npx') as AcpLaunchDistributionType
  const cmd = row.overrideCmd ?? row.cmd ?? ''
  const args = row.overrideArgs != null
    ? parseArgsJson(row.overrideArgs)
    : parseArgsJson(row.args)
  const env = row.overrideEnv != null
    ? { ...parseEnvJson(row.env), ...parseEnvJson(row.overrideEnv) }
    : parseEnvJson(row.env)

  return {
    distributionType,
    installPath: row.installPath,
    cmd,
    args,
    env,
  }
}

/**
 * Resolve the executable path for a binary distribution.
 * Absolute cmd is used as-is. Relative cmd is joined under installPath and
 * must stay under that install root (reject `..` traversal).
 */
export function resolveBinaryCommand(installPath: string, cmd: string): string {
  if (!installPath) {
    throw new Error('installPath is required for binary ACP agents')
  }
  if (isAbsolute(cmd)) {
    return cmd
  }
  const root = normalize(installPath)
  const resolved = normalize(join(root, cmd))
  const rootWithSep = root.endsWith(sep) ? root : `${root}${sep}`
  if (resolved !== root && !resolved.startsWith(rootWithSep)) {
    throw new Error(`binary cmd escapes installPath: ${cmd}`)
  }
  return resolved
}

/** Reject absolute paths for package-style (npx/uvx) override cmd values. */
export function isAbsoluteOrPathLikeCommand(cmd: string): boolean {
  if (isAbsolute(cmd)) {
    return true
  }
  // Path separators in the middle of scoped packages like @scope/pkg are fine;
  // reject only leading path segments and `..` components that look like filesystem paths.
  if (cmd.startsWith('.') || cmd.includes('..')) {
    return true
  }
  if (cmd.includes(sep) && !cmd.startsWith('@')) {
    return true
  }
  return false
}
