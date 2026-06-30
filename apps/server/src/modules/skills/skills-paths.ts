import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export type SkillScope = 'builtin' | 'legacy' | 'global' | 'repository' | 'workspace' | 'agent'

export interface SkillContext {
  workspacePath?: string
  agentId?: string
}

const UNSAFE_PATH_RE = /[/\\]|\.\./
const CRADLE_DIR_PARTS = ['.cradle'] as const
const AGENT_SKILL_COMPAT_DIRS = ['.agents', '.claude'] as const

export function resolveScopeRoot(scope: SkillScope, context: SkillContext): string {
  switch (scope) {
    case 'builtin':
      return resolveBuiltinSkillsRoot()
    case 'legacy':
      return path.join(os.homedir(), '.agents', 'skills')
    case 'global':
      return path.join(os.homedir(), ...CRADLE_DIR_PARTS, 'skills')
    case 'repository':
      if (!context.workspacePath) {
        throw new Error('workspacePath is required for repository skills')
      }
      return path.join(context.workspacePath, '.agents', 'skills')
    case 'workspace':
      if (!context.workspacePath) {
        throw new Error('workspacePath is required for workspace skills')
      }
      return path.join(context.workspacePath, ...CRADLE_DIR_PARTS, 'skills')
    case 'agent':
      if (!context.agentId) {
        throw new Error('agentId is required for agent skills')
      }
      return path.join(ensureAgentRuntimeHome(context.agentId), 'skills')
  }
}

export function resolveAgentHomeRoot(agentId: string): string {
  assertAgentId(agentId)
  return path.join(os.homedir(), ...CRADLE_DIR_PARTS, 'agents', agentId)
}

export function ensureAgentRuntimeHome(agentId: string): string {
  const agentHome = resolveAgentHomeRoot(agentId)
  const skillsRoot = path.join(agentHome, 'skills')
  fs.mkdirSync(skillsRoot, { recursive: true })

  for (const compatDirName of AGENT_SKILL_COMPAT_DIRS) {
    const compatDir = path.join(agentHome, compatDirName)
    fs.mkdirSync(compatDir, { recursive: true })
    ensureDirectorySymlink(path.join(compatDir, 'skills'), '../skills')
  }

  linkBuiltinSkills(skillsRoot)
  return agentHome
}

export function assertWorkspaceId(workspaceId: string): void {
  assertSafeId(workspaceId)
}

export function assertAgentId(agentId: string): void {
  assertSafeId(agentId)
}

export function assertWritableScope(scope: SkillScope): void {
  if (scope === 'builtin' || scope === 'legacy' || scope === 'repository') {
    throw new Error(`${scope} skills are read-only`)
  }
}

function assertSafeId(id: string): void {
  if (!id || UNSAFE_PATH_RE.test(id)) {
    throw new Error(`Invalid ID: ${id}`)
  }
}

function resolveBuiltinSkillsRoot(): string {
  const configuredRoot = process.env.CRADLE_BUILTIN_SKILLS_DIR?.trim()
  if (configuredRoot) {
    return configuredRoot
  }

  const candidates = [
    path.resolve(process.cwd(), '../../../resources/skills'),
    path.resolve(process.cwd(), '../../resources/skills'),
    path.resolve(process.cwd(), '../resources/skills'),
    path.resolve(process.cwd(), 'resources/skills'),
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }

  return candidates[0]
}

function linkBuiltinSkills(skillsRoot: string): void {
  const builtinRoot = resolveBuiltinSkillsRoot()
  if (!fs.existsSync(builtinRoot)) {
    return
  }

  for (const entry of fs.readdirSync(builtinRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue
    }
    const sourceDir = path.join(builtinRoot, entry.name)
    if (!fs.existsSync(path.join(sourceDir, 'SKILL.md'))) {
      continue
    }
    const target = path.join(skillsRoot, entry.name)
    try {
      const stat = fs.lstatSync(target)
      if (!stat.isSymbolicLink()) {
        continue
      }
      if (fs.readlinkSync(target) === sourceDir) {
        continue
      }
      fs.rmSync(target, { recursive: true, force: true })
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }
    fs.symlinkSync(sourceDir, target, 'dir')
  }
}

function ensureDirectorySymlink(linkPath: string, target: string): void {
  try {
    const stat = fs.lstatSync(linkPath)
    if (stat.isSymbolicLink() && fs.readlinkSync(linkPath) === target) {
      return
    }
    fs.rmSync(linkPath, { recursive: true, force: true })
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }
  fs.symlinkSync(target, linkPath, 'dir')
}
