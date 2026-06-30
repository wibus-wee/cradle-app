// Resolves Cradle-owned Codex runtime filesystem context for one chat session.

import { getPluginSkillProjectionSources } from '../../../../plugins/skill-registry'
import { isAppFeatureFlagEnabled } from '../../../preferences/service'
import {
  createAgentNativeSkillProjectionTarget,
  createCodexGlobalNativeSkillProjectionTarget,
  getBuiltinSkillProjectionSources,
  reconcileNativeSkillProjections,
  registerNativeSkillProjectionTarget,
} from '../../../skills/native-skill-projection'
import { ensureAgentRuntimeHome } from '../../../skills/skills-paths'

export interface CodexRuntimeContext {
  cwd: string
  workspacePath: string
  runtimeWorkspaceRoots: string[]
  agentHome: string | null
}

export function resolveCodexRuntimeContext(workspacePath: string, agentId?: string | null): CodexRuntimeContext {
  const resolvedWorkspacePath = workspacePath || '.'
  const agentHome = agentId ? ensureAgentRuntimeHome(agentId) : null
  if (agentHome) {
    registerAgentNativeSkillProjectionTarget(agentHome)
  }
  else if (isAppFeatureFlagEnabled('nativeProviderSkillProjection')) {
    registerCodexGlobalNativeSkillProjectionTarget()
  }
  const runtimeWorkspaceRoots = uniquePaths([
    agentHome,
    resolvedWorkspacePath,
  ])

  return {
    cwd: agentHome ?? resolvedWorkspacePath,
    workspacePath: resolvedWorkspacePath,
    runtimeWorkspaceRoots,
    agentHome,
  }
}

function registerAgentNativeSkillProjectionTarget(agentHome: string): void {
  registerNativeSkillProjectionTarget(createAgentNativeSkillProjectionTarget(agentHome))
  reconcileRuntimeNativeSkillProjections()
}

function registerCodexGlobalNativeSkillProjectionTarget(): void {
  registerNativeSkillProjectionTarget(createCodexGlobalNativeSkillProjectionTarget())
  reconcileRuntimeNativeSkillProjections()
}

function reconcileRuntimeNativeSkillProjections(): void {
  reconcileNativeSkillProjections([
    ...getBuiltinSkillProjectionSources(),
    ...getPluginSkillProjectionSources(),
  ])
}

function uniquePaths(paths: Array<string | null | undefined>): string[] {
  return [...new Set(paths.filter((path): path is string => Boolean(path)))]
}
