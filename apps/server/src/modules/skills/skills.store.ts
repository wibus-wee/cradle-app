import fs from 'node:fs'
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import yaml from 'js-yaml'
import { z } from 'zod'

import type { SkillContext, SkillScope } from './skills-paths'
import { assertWritableScope, resolveScopeRoot } from './skills-paths'

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/
const LEADING_BLANK_LINE_RE = /^\r?\n/
const SKILL_NAME_SEGMENT_RE = /[^a-z0-9._-]+/g
const SKILL_NAME_TRIM_RE = /^-+|-+$/g

const SCOPE_PRIORITY: Record<SkillScope, number> = {
  builtin: 0,
  legacy: 1,
  global: 2,
  repository: 3,
  workspace: 4,
  agent: 5,
}

const SkillFrontmatterSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
}).passthrough()

const SkillFrontmatterBaseSchema = z.record(z.string(), z.unknown()).default({})

const SkillDocumentFrontmatterSchema = z.object({
  base: SkillFrontmatterBaseSchema,
  next: SkillFrontmatterBaseSchema,
  name: z.string().min(1),
  description: z.string().min(1),
}).transform(input => ({
  ...input.base,
  ...input.next,
  name: input.name,
  description: input.description,
}))

interface ParsedSkillDocument {
  frontmatter: Record<string, unknown>
  name: string
  description: string
  body: string
}

interface DirectoryScanCacheEntry {
  signature: string
  entries: SkillCatalogEntry[]
}

const directoryScanCache = new Map<string, DirectoryScanCacheEntry>()

export interface SkillCatalogEntry {
  name: string
  description: string
  location: string
  scope: SkillScope
  rootDir: string
  skillDir: string
}

export interface SkillInventoryEntry extends SkillCatalogEntry {
  active: boolean
  shadowedBy: SkillScope | null
}

export interface SkillDocument extends SkillCatalogEntry {
  body: string
  frontmatter: Record<string, unknown>
}

export interface SkillLookup extends SkillContext {
  scope: SkillScope
  name: string
}

export interface CreateSkillInput extends SkillContext {
  name: string
  description: string
  body: string
  frontmatter?: Record<string, unknown>
}

export interface UpdateSkillInput extends SkillContext {
  scope: SkillScope
  name: string
  document: {
    name: string
    description: string
    body: string
    frontmatter?: Record<string, unknown>
  }
}

export interface ImportSkillInput extends SkillContext {
  sourceDir: string
  overwrite?: boolean
}

export interface ExportSkillInput extends SkillLookup {
  destinationDir: string
  overwrite?: boolean
}

export interface ImportMultipleInput extends SkillContext {
  sourceDirs: string[]
  overwrite?: boolean
}

export function scanSkills(context: SkillContext = {}): SkillCatalogEntry[] {
  return listSkillInventory(context).filter(entry => entry.active)
}

export function listSkillInventory(context: SkillContext = {}): SkillInventoryEntry[] {
  const scopedEntries = scanAllScopes(context)
  const activeScopeByName = new Map<string, SkillScope>()

  for (const { entries } of scopedEntries) {
    for (const entry of entries) {
      const current = activeScopeByName.get(entry.name)
      if (!current || SCOPE_PRIORITY[entry.scope] >= SCOPE_PRIORITY[current]) {
        activeScopeByName.set(entry.name, entry.scope)
      }
    }
  }

  return scopedEntries.flatMap(({ entries }) => entries.map((entry) => {
    const activeScope = activeScopeByName.get(entry.name) ?? null
    return {
      ...entry,
      active: activeScope === entry.scope,
      shadowedBy: activeScope === entry.scope ? null : activeScope,
    }
  }))
}

export async function readSkillDocument(input: SkillLookup): Promise<SkillDocument> {
  const entry = resolveInventoryEntry(input)
  const content = await readFile(entry.location, 'utf8')
  const parsed = parseSkillDocument(content)
  return toSkillDocument(entry, parsed)
}

export async function createSkillDocument(scope: SkillScope, input: CreateSkillInput): Promise<SkillDocument> {
  assertWritableScope(scope)
  assertSkillName(input.name)
  const rootDir = resolveScopeRoot(scope, input)
  const skillDir = path.join(rootDir, toSkillDirName(input.name))

  if (fs.existsSync(skillDir)) {
    throw new Error(`Skill "${input.name}" already exists`)
  }

  await mkdir(skillDir, { recursive: true })
  const frontmatter = SkillDocumentFrontmatterSchema.parse({
    next: input.frontmatter,
    name: input.name,
    description: input.description,
  })
  const skillPath = path.join(skillDir, 'SKILL.md')
  await writeFile(skillPath, serializeSkillDocument(frontmatter, input.body), 'utf8')
  invalidateScopeCache(scope, input)

  return {
    name: input.name,
    description: input.description,
    body: input.body,
    frontmatter,
    location: skillPath,
    scope,
    rootDir,
    skillDir,
  }
}

export async function updateSkillDocument(input: UpdateSkillInput): Promise<SkillDocument> {
  assertWritableScope(input.scope)
  assertSkillName(input.document.name)
  const existing = await readSkillDocument({
    scope: input.scope,
    name: input.name,
    workspacePath: input.workspacePath,
    agentId: input.agentId,
  })

  const nextFrontmatter = SkillDocumentFrontmatterSchema.parse({
    base: existing.frontmatter,
    next: input.document.frontmatter,
    name: input.document.name,
    description: input.document.description,
  })

  const targetSkillDir = path.join(existing.rootDir, toSkillDirName(input.document.name))
  if (targetSkillDir !== existing.skillDir && fs.existsSync(targetSkillDir)) {
    throw new Error(`Skill "${input.document.name}" already exists at target location`)
  }

  if (targetSkillDir !== existing.skillDir) {
    await rename(existing.skillDir, targetSkillDir)
  }

  const targetLocation = path.join(targetSkillDir, 'SKILL.md')
  await writeFile(targetLocation, serializeSkillDocument(nextFrontmatter, input.document.body), 'utf8')
  invalidateScopeCache(input.scope, input)

  return {
    name: input.document.name,
    description: input.document.description,
    body: input.document.body,
    frontmatter: nextFrontmatter,
    location: targetLocation,
    scope: input.scope,
    rootDir: existing.rootDir,
    skillDir: targetSkillDir,
  }
}

export async function deleteSkillDocument(input: SkillLookup): Promise<void> {
  assertWritableScope(input.scope)
  const entry = resolveInventoryEntry(input)
  await rm(entry.skillDir, { recursive: true, force: true })
  invalidateScopeCache(input.scope, input)
}

export async function importSkillPackage(scope: SkillScope, input: ImportSkillInput): Promise<SkillDocument> {
  assertWritableScope(scope)
  const sourceSkillPath = path.join(input.sourceDir, 'SKILL.md')
  const content = await readFile(sourceSkillPath, 'utf8')
  const parsed = parseSkillDocument(content)
  assertSkillName(parsed.name)

  const rootDir = resolveScopeRoot(scope, input)
  const targetDir = path.join(rootDir, toSkillDirName(parsed.name))

  if (fs.existsSync(targetDir)) {
    if (!input.overwrite) {
      throw new Error(`Skill already exists: ${parsed.name}`)
    }
    await rm(targetDir, { recursive: true, force: true })
  }

  await mkdir(rootDir, { recursive: true })
  await cp(input.sourceDir, targetDir, { recursive: true })
  invalidateScopeCache(scope, input)

  return {
    name: parsed.name,
    description: parsed.description,
    body: parsed.body,
    frontmatter: parsed.frontmatter,
    location: path.join(targetDir, 'SKILL.md'),
    scope,
    rootDir,
    skillDir: targetDir,
  }
}

export async function importMultipleSkillPackages(scope: SkillScope, input: ImportMultipleInput): Promise<{ imported: SkillDocument[], errors: Array<{ dir: string, error: string }> }> {
  const imported: SkillDocument[] = []
  const errors: Array<{ dir: string, error: string }> = []

  for (const sourceDir of input.sourceDirs) {
    try {
      imported.push(await importSkillPackage(scope, {
        sourceDir,
        overwrite: input.overwrite,
        workspacePath: input.workspacePath,
        agentId: input.agentId,
      }))
    }
    catch (error) {
      errors.push({
        dir: sourceDir,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return { imported, errors }
}

export async function exportSkillPackage(input: ExportSkillInput): Promise<string> {
  const entry = resolveInventoryEntry(input)
  const destination = path.join(input.destinationDir, path.basename(entry.skillDir))

  if (fs.existsSync(destination)) {
    if (!input.overwrite) {
      throw new Error(`Export destination already exists: ${destination}`)
    }
    await rm(destination, { recursive: true, force: true })
  }

  await mkdir(input.destinationDir, { recursive: true })
  await cp(entry.skillDir, destination, { recursive: true })
  return destination
}

function scanAllScopes(context: SkillContext): Array<{ scope: SkillScope, entries: SkillCatalogEntry[] }> {
  const results: Array<{ scope: SkillScope, entries: SkillCatalogEntry[] }> = []
  for (const scope of ['builtin', 'legacy', 'global'] as const) {
    results.push({ scope, entries: scanDirectory(resolveScopeRoot(scope, context), scope) })
  }

  if (context.workspacePath) {
    results.push({ scope: 'repository', entries: scanDirectory(resolveScopeRoot('repository', context), 'repository') })
    results.push({ scope: 'workspace', entries: scanDirectory(resolveScopeRoot('workspace', context), 'workspace') })
  }
  if (context.agentId) {
    results.push({ scope: 'agent', entries: scanDirectory(resolveScopeRoot('agent', context), 'agent') })
  }
  return results
}

function scanDirectory(rootDir: string, scope: SkillScope): SkillCatalogEntry[] {
  if (!fs.existsSync(rootDir)) {
    directoryScanCache.delete(getDirectoryScanCacheKey(scope, rootDir))
    return []
  }

  let dirEntries: fs.Dirent[]
  try {
    dirEntries = fs.readdirSync(rootDir, { withFileTypes: true })
  }
  catch {
    directoryScanCache.delete(getDirectoryScanCacheKey(scope, rootDir))
    return []
  }

  const candidates: Array<{ skillDir: string, skillPath: string }> = []
  const signatureParts: string[] = []
  for (const dirEntry of dirEntries) {
    const skillDir = path.join(rootDir, dirEntry.name)
    const skillPath = path.join(skillDir, 'SKILL.md')
    if (!fs.existsSync(skillPath)) {
      continue
    }

    try {
      const stat = fs.statSync(skillPath)
      signatureParts.push(`${dirEntry.name}:${stat.size}:${stat.mtimeMs}`)
      candidates.push({ skillDir, skillPath })
    }
    catch {
      // Ignore transient stat failures.
    }
  }

  const cacheKey = getDirectoryScanCacheKey(scope, rootDir)
  const signature = signatureParts.join('|')
  const cached = directoryScanCache.get(cacheKey)
  if (cached && cached.signature === signature) {
    return cloneCatalogEntries(cached.entries)
  }

  const result: SkillCatalogEntry[] = []
  for (const { skillDir, skillPath } of candidates) {
    try {
      const parsed = parseSkillDocument(fs.readFileSync(skillPath, 'utf8'))
      result.push({
        name: parsed.name,
        description: parsed.description,
        location: skillPath,
        scope,
        rootDir,
        skillDir,
      })
    }
    catch {
      // Skip malformed packages.
    }
  }

  directoryScanCache.set(cacheKey, { signature, entries: cloneCatalogEntries(result) })
  return result
}

function resolveInventoryEntry(input: SkillLookup): SkillCatalogEntry {
  const entries = listSkillInventory({ workspacePath: input.workspacePath, agentId: input.agentId })
  const match = entries.find(entry => entry.scope === input.scope && entry.name === input.name)
  if (!match) {
    throw new Error(`Skill not found: ${input.scope}:${input.name}`)
  }
  return match
}

function assertSkillName(name: string): void {
  if (!name.trim()) {
    throw new Error('Skill name is required')
  }
}

function parseSkillDocument(content: string): ParsedSkillDocument {
  const match = content.match(FRONTMATTER_RE)
  if (!match) {
    throw new Error('SKILL.md is missing YAML frontmatter')
  }

  const frontmatter = SkillFrontmatterSchema.parse(yaml.load(match[1]))

  return {
    frontmatter,
    name: frontmatter.name,
    description: frontmatter.description,
    body: content.slice(match[0].length).replace(LEADING_BLANK_LINE_RE, ''),
  }
}

function serializeSkillDocument(frontmatter: Record<string, unknown>, body: string): string {
  const yamlBlock = yaml.dump(frontmatter, { lineWidth: -1, noRefs: true, sortKeys: false }).trimEnd()
  return `---\n${yamlBlock}\n---\n\n${body}`
}

function toSkillDocument(entry: SkillCatalogEntry, parsed: ParsedSkillDocument): SkillDocument {
  return {
    ...entry,
    name: parsed.name,
    description: parsed.description,
    body: parsed.body,
    frontmatter: parsed.frontmatter,
  }
}

function toSkillDirName(name: string): string {
  return name.trim().toLowerCase().replace(SKILL_NAME_SEGMENT_RE, '-').replace(SKILL_NAME_TRIM_RE, '')
}

function cloneCatalogEntries(entries: SkillCatalogEntry[]): SkillCatalogEntry[] {
  return entries.map(entry => ({ ...entry }))
}

function getDirectoryScanCacheKey(scope: SkillScope, rootDir: string): string {
  return `${scope}:${rootDir}`
}

function invalidateScopeCache(scope: SkillScope, context: SkillContext): void {
  try {
    directoryScanCache.delete(getDirectoryScanCacheKey(scope, resolveScopeRoot(scope, context)))
  }
  catch {
    // Ignore partial context failures.
  }
}
