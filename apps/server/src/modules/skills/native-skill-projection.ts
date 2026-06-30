import fs from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

import { resolveScopeRoot } from './skills-paths'

export type NativeSkillProjectionLayout = 'nested' | 'flat'
export type NativeSkillProjectionSourceKind = 'plugin' | 'resource' | 'builtin'

export interface NativeSkillProjectionTarget {
  id: string
  skillRoot: string
  layout: NativeSkillProjectionLayout
  sourceKinds?: readonly NativeSkillProjectionSourceKind[]
}

export interface NativeSkillProjectionSource {
  sourceKind: NativeSkillProjectionSourceKind
  skillName: string
  skillFile: string
}

export interface NativeSkillProjectionError {
  targetId: string
  source?: NativeSkillProjectionSource
  path?: string
  error: string
}

export interface NativeSkillProjectionReconcileResult {
  projected: string[]
  removed: string[]
  errors: NativeSkillProjectionError[]
}

const SAFE_SKILL_NAME_RE = /[^a-z0-9._-]+/g
const SAFE_SKILL_NAME_TRIM_RE = /^-+|-+$/g
const CRADLE_SOURCE_PREFIXES: readonly NativeSkillProjectionSourceKind[] = ['plugin', 'resource', 'builtin']

const targets = new Map<string, NativeSkillProjectionTarget>()

export function sanitizeNativeSkillProjectionName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(SAFE_SKILL_NAME_RE, '-')
    .replace(SAFE_SKILL_NAME_TRIM_RE, '')
    || 'skill'
}

export function resolveNativeSkillPackageDir(skillFile: string): string {
  const resolvedSkillFile = path.resolve(skillFile)
  let candidateDir: string

  try {
    const stat = fs.statSync(resolvedSkillFile)
    candidateDir = stat.isDirectory()
      ? resolvedSkillFile
      : path.dirname(resolvedSkillFile)
  }
  catch {
    candidateDir = path.basename(resolvedSkillFile) === 'SKILL.md'
      ? path.dirname(resolvedSkillFile)
      : resolvedSkillFile
  }

  const skillPath = path.join(candidateDir, 'SKILL.md')
  if (!fs.existsSync(skillPath)) {
    throw new Error(`Skill package is missing SKILL.md: ${candidateDir}`)
  }

  return candidateDir
}

export function resolveNativeSkillProjectionEntryName(source: NativeSkillProjectionSource): string {
  const skillName = sanitizeNativeSkillProjectionName(source.skillName)
  return source.sourceKind === 'builtin'
    ? skillName
    : `${source.sourceKind}-${skillName}`
}

export function resolveNativeSkillProjectionPath(
  target: NativeSkillProjectionTarget,
  source: NativeSkillProjectionSource,
): string {
  const skillRoot = path.resolve(target.skillRoot)
  const targetName = resolveNativeSkillProjectionEntryName(source)
  const projectionPath = target.layout === 'nested'
    ? path.join(skillRoot, 'cradle', targetName)
    : path.join(skillRoot, `cradle-${targetName}`)
  assertPathInside(skillRoot, projectionPath)
  return projectionPath
}

export function projectNativeSkill(
  target: NativeSkillProjectionTarget,
  source: NativeSkillProjectionSource,
): string {
  const sourceDir = resolveNativeSkillPackageDir(source.skillFile)
  const projectionPath = resolveNativeSkillProjectionPath(target, source)
  fs.mkdirSync(path.dirname(projectionPath), { recursive: true })

  try {
    const stat = fs.lstatSync(projectionPath)
    if (!stat.isSymbolicLink()) {
      throw new Error(`Native skill projection conflict at ${projectionPath}`)
    }

    const currentTarget = resolveSymlinkTarget(projectionPath)
    if (currentTarget === path.resolve(sourceDir)) {
      return projectionPath
    }

    fs.rmSync(projectionPath, { recursive: true, force: true })
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }

  fs.symlinkSync(sourceDir, projectionPath, 'dir')
  return projectionPath
}

export function removeNativeSkillProjection(
  target: NativeSkillProjectionTarget,
  source: NativeSkillProjectionSource,
): void {
  const projectionPath = resolveNativeSkillProjectionPath(target, source)
  removeProjectionSymlink(projectionPath)
}

export function registerNativeSkillProjectionTarget(target: NativeSkillProjectionTarget): void {
  targets.set(target.id, {
    ...target,
    skillRoot: path.resolve(target.skillRoot),
    sourceKinds: target.sourceKinds ? [...target.sourceKinds] : undefined,
  })
}

export function unregisterNativeSkillProjectionTarget(targetId: string): void {
  targets.delete(targetId)
}

export function listNativeSkillProjectionTargets(): NativeSkillProjectionTarget[] {
  return Array.from(targets.values(), target => ({
    ...target,
    sourceKinds: target.sourceKinds ? [...target.sourceKinds] : undefined,
  }))
}

export function resetNativeSkillProjectionTargets(): void {
  targets.clear()
}

export function createAgentNativeSkillProjectionTarget(agentHome: string): NativeSkillProjectionTarget {
  const skillRoot = path.join(agentHome, 'skills')
  return {
    id: `agent:${path.resolve(agentHome)}:skills`,
    skillRoot,
    layout: 'nested',
    sourceKinds: ['plugin', 'resource'],
  }
}

export function createCodexGlobalNativeSkillProjectionTarget(homeDir = homedir()): NativeSkillProjectionTarget {
  const skillRoot = path.join(homeDir, '.codex', 'skills')
  return {
    id: `global:codex:${path.resolve(skillRoot)}`,
    skillRoot,
    layout: 'nested',
    sourceKinds: ['plugin', 'resource', 'builtin'],
  }
}

export function createClaudeGlobalNativeSkillProjectionTarget(homeDir = homedir()): NativeSkillProjectionTarget {
  const skillRoot = path.join(homeDir, '.claude', 'skills')
  return {
    id: `global:claude:${path.resolve(skillRoot)}`,
    skillRoot,
    layout: 'flat',
    sourceKinds: ['plugin', 'resource', 'builtin'],
  }
}

export function getBuiltinSkillProjectionSources(): NativeSkillProjectionSource[] {
  const builtinRoot = resolveScopeRoot('builtin', {})
  if (!fs.existsSync(builtinRoot)) {
    return []
  }

  const sources: NativeSkillProjectionSource[] = []
  for (const entry of fs.readdirSync(builtinRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue
    }
    const skillDir = path.join(builtinRoot, entry.name)
    const skillFile = path.join(skillDir, 'SKILL.md')
    if (!fs.existsSync(skillFile)) {
      continue
    }
    sources.push({
      sourceKind: 'builtin',
      skillName: entry.name,
      skillFile,
    })
  }
  return sources
}

export function reconcileNativeSkillProjections(
  sources: readonly NativeSkillProjectionSource[],
  inputTargets: readonly NativeSkillProjectionTarget[] = listNativeSkillProjectionTargets(),
): NativeSkillProjectionReconcileResult {
  const result: NativeSkillProjectionReconcileResult = {
    projected: [],
    removed: [],
    errors: [],
  }

  for (const target of inputTargets) {
    const normalizedTarget = {
      ...target,
      skillRoot: path.resolve(target.skillRoot),
    }
    const sourceKinds = new Set(normalizedTarget.sourceKinds ?? CRADLE_SOURCE_PREFIXES)
    const desiredPaths = new Set<string>()
    const projectableSources: NativeSkillProjectionSource[] = []
    for (const source of sources) {
      if (!sourceKinds.has(source.sourceKind)) {
        continue
      }
      try {
        resolveNativeSkillPackageDir(source.skillFile)
        desiredPaths.add(resolveNativeSkillProjectionPath(normalizedTarget, source))
        projectableSources.push(source)
      }
      catch (error) {
        recordProjectionError(result, normalizedTarget, source, error)
      }
    }
    result.removed.push(...removeStaleProjectionSymlinks(normalizedTarget, desiredPaths, sourceKinds))
    result.removed.push(...removeLegacyNestedCradleDirectory(normalizedTarget))

    for (const source of projectableSources) {
      try {
        result.projected.push(projectNativeSkill(normalizedTarget, source))
      }
      catch (error) {
        recordProjectionError(result, normalizedTarget, source, error)
      }
    }
  }

  return result
}

function recordProjectionError(
  result: NativeSkillProjectionReconcileResult,
  target: NativeSkillProjectionTarget,
  source: NativeSkillProjectionSource,
  error: unknown,
): void {
  let projectionPath: string | undefined
  try {
    projectionPath = resolveNativeSkillProjectionPath(target, source)
  }
  catch {
    projectionPath = undefined
  }
  result.errors.push({
    targetId: target.id,
    source,
    path: projectionPath,
    error: error instanceof Error ? error.message : String(error),
  })
}

function removeStaleProjectionSymlinks(
  target: NativeSkillProjectionTarget,
  desiredPaths: Set<string>,
  sourceKinds: ReadonlySet<NativeSkillProjectionSourceKind>,
): string[] {
  const removed: string[] = []
  const root = path.resolve(target.skillRoot)
  const candidateParent = target.layout === 'nested' ? path.join(root, 'cradle') : root

  if (!fs.existsSync(candidateParent)) {
    return removed
  }

  for (const entry of fs.readdirSync(candidateParent, { withFileTypes: true })) {
    const candidatePath = path.join(candidateParent, entry.name)
    if (!isCradleProjectionEntryName(target.layout, entry.name, sourceKinds) || desiredPaths.has(candidatePath)) {
      continue
    }
    if (removeProjectionSymlink(candidatePath)) {
      removed.push(candidatePath)
    }
  }

  return removed
}

function isCradleProjectionEntryName(
  layout: NativeSkillProjectionLayout,
  name: string,
  sourceKinds: ReadonlySet<NativeSkillProjectionSourceKind>,
): boolean {
  if (sourceKinds.has('plugin') && matchesProjectionPrefix(layout, name, 'plugin')) {
    return true
  }
  if (sourceKinds.has('resource') && matchesProjectionPrefix(layout, name, 'resource')) {
    return true
  }
  if (!sourceKinds.has('builtin')) {
    return false
  }

  return layout === 'nested'
    ? !matchesProjectionPrefix(layout, name, 'plugin') && !matchesProjectionPrefix(layout, name, 'resource')
    : name.startsWith('cradle-')
      && !matchesProjectionPrefix(layout, name, 'plugin')
      && !matchesProjectionPrefix(layout, name, 'resource')
}

function matchesProjectionPrefix(
  layout: NativeSkillProjectionLayout,
  name: string,
  sourceKind: NativeSkillProjectionSourceKind,
): boolean {
  return layout === 'nested'
    ? name.startsWith(`${sourceKind}-`)
    : name.startsWith(`cradle-${sourceKind}-`)
}

function removeLegacyNestedCradleDirectory(target: NativeSkillProjectionTarget): string[] {
  if (target.layout !== 'flat') {
    return []
  }

  const removed: string[] = []
  const legacyDir = path.join(path.resolve(target.skillRoot), 'cradle')

  if (!fs.existsSync(legacyDir)) {
    return removed
  }

  for (const entry of fs.readdirSync(legacyDir, { withFileTypes: true })) {
    const entryPath = path.join(legacyDir, entry.name)
    if (removeProjectionSymlink(entryPath)) {
      removed.push(entryPath)
    }
  }

  try {
    const remaining = fs.readdirSync(legacyDir)
    if (remaining.length === 0) {
      fs.rmdirSync(legacyDir)
    }
  }
  catch {
    // ignore — directory may have been concurrently modified
  }

  return removed
}

function removeProjectionSymlink(projectionPath: string): boolean {
  try {
    const stat = fs.lstatSync(projectionPath)
    if (!stat.isSymbolicLink()) {
      return false
    }
    fs.unlinkSync(projectionPath)
    return true
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
    return false
  }
}

function resolveSymlinkTarget(linkPath: string): string {
  const target = fs.readlinkSync(linkPath)
  return path.resolve(path.dirname(linkPath), target)
}

function assertPathInside(root: string, child: string): void {
  const relative = path.relative(root, child)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Native skill projection path escapes skill root: ${child}`)
  }
}
