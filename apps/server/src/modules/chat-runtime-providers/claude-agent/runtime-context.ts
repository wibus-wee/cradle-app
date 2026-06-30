// Resolves Cradle-owned Claude Agent runtime filesystem context for one chat session.

import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { getPluginSkillProjectionSources } from '../../../plugins/skill-registry'
import { isAppFeatureFlagEnabled } from '../../preferences/service'
import {
  createAgentNativeSkillProjectionTarget,
  createClaudeGlobalNativeSkillProjectionTarget,
  getBuiltinSkillProjectionSources,
  reconcileNativeSkillProjections,
  registerNativeSkillProjectionTarget,
} from '../../skills/native-skill-projection'
import { ensureAgentRuntimeHome } from '../../skills/skills-paths'

export interface ClaudeAgentRuntimeContext {
  cwd: string
  workspacePath: string
  additionalDirectories: string[]
  agentHome: string | null
}

export function resolveClaudeAgentRuntimeContext(workspacePath: string | undefined, agentId?: string | null): ClaudeAgentRuntimeContext {
  const resolvedWorkspacePath = workspacePath || process.cwd()
  const agentHome = agentId ? ensureAgentRuntimeHome(agentId) : null
  if (agentHome) {
    registerAgentNativeSkillProjectionTarget(agentHome)
  }
  else if (isAppFeatureFlagEnabled('nativeProviderSkillProjection')) {
    registerClaudeGlobalNativeSkillProjectionTarget()
  }

  return {
    cwd: agentHome ?? resolvedWorkspacePath,
    workspacePath: resolvedWorkspacePath,
    additionalDirectories: uniquePaths([
      agentHome ? resolvedWorkspacePath : null,
    ]),
    agentHome,
  }
}

function registerAgentNativeSkillProjectionTarget(agentHome: string): void {
  registerNativeSkillProjectionTarget(createAgentNativeSkillProjectionTarget(agentHome))
  reconcileRuntimeNativeSkillProjections()
}

function registerClaudeGlobalNativeSkillProjectionTarget(): void {
  registerNativeSkillProjectionTarget(createClaudeGlobalNativeSkillProjectionTarget())
  reconcileRuntimeNativeSkillProjections()
}

function reconcileRuntimeNativeSkillProjections(): void {
  reconcileNativeSkillProjections([
    ...getBuiltinSkillProjectionSources(),
    ...getPluginSkillProjectionSources(),
  ])
}

export function resolveClaudeAgentSdkConfigDir(input: {
  env?: NodeJS.ProcessEnv
  homeDir?: string
} = {}): string {
  const env = input.env ?? process.env
  const dataDir = env.CRADLE_DATA_DIR?.trim()
  if (dataDir) {
    return join(dataDir, 'runtimes', 'claude-agent')
  }

  const dbPath = env.CRADLE_DB_PATH?.trim()
  if (dbPath) {
    return join(dirname(dbPath), 'runtimes', 'claude-agent')
  }

  return join(input.homeDir ?? homedir(), '.cradle', 'runtimes', 'claude-agent')
}

export function prepareClaudeAgentSdkConfigDir(): string {
  const configDir = resolveClaudeAgentSdkConfigDir()
  mkdirSync(configDir, { recursive: true })
  return configDir
}

export function activateClaudeAgentSdkConfigDir(): string {
  const configDir = prepareClaudeAgentSdkConfigDir()
  process.env.CLAUDE_CONFIG_DIR = configDir
  return configDir
}

export function removeCradleOwnedClaudeConfigDirFromEnv(env: NodeJS.ProcessEnv): void {
  const configDir = env.CLAUDE_CONFIG_DIR?.trim()
  if (!configDir) {
    return
  }
  if (resolve(configDir) !== resolve(resolveClaudeAgentSdkConfigDir({ env }))) {
    return
  }
  delete env.CLAUDE_CONFIG_DIR
  delete env.CLAUDE_SECURESTORAGE_CONFIG_DIR
}

function uniquePaths(paths: Array<string | null | undefined>): string[] {
  return [...new Set(paths.filter((path): path is string => Boolean(path)))]
}
