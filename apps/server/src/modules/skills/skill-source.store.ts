import fs from 'node:fs'
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path, { isAbsolute, join, resolve } from 'node:path'

import simpleGit from 'simple-git'

export type SkillSourceType = 'github' | 'gitlab' | 'git' | 'local'

export interface ParsedSkillSource {
  type: SkillSourceType
  url: string
  ref?: string
  subpath?: string
  label: string
}

export interface DiscoveredSkill {
  name: string
  description: string
  skillDir: string
  relativePath: string
}

export interface FetchSessionResult {
  sessionId: string
  source: ParsedSkillSource
  skills: DiscoveredSkill[]
  tempDir: string | null
}

export interface FetchSessionSnapshot {
  sessionId: string
  source: ParsedSkillSource
  skills: DiscoveredSkill[]
  tempDir: string | null
}

const SESSION_TTL_MS = 15 * 60 * 1000
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', '.next', 'out'])
const RE_WIN_PATH = /^[a-z]:[/\\]/i
const RE_BACKSLASH = /\\/g
const RE_GIT_SUFFIX = /\.git$/
const RE_QUOTE_WRAP = /^["']|["']$/g
const RE_SSH_LABEL = /^git@[^:]+:/
const RE_GITHUB_TREE_PATH = /github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)/
const RE_GITHUB_TREE = /github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)$/
const RE_GITHUB_REPO = /github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/
const RE_GITLAB_TREE_PATH = /^(https?):\/\/([^/]+)\/(.+?)\/-\/tree\/([^/]+)\/(.+)/
const RE_GITLAB_TREE = /^(https?):\/\/([^/]+)\/(.+?)\/-\/tree\/([^/]+)$/
const RE_GITLAB_REPO = /gitlab\.com\/(.+?)(?:\.git)?\/?$/
const RE_SHORTHAND = /^([^/]+)\/([^/]+)(?:\/(.+))?$/
const RE_FM_SPLIT = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/
const RE_FM_NAME = /^name:\s*(\S[^\n]*)$/m
const RE_FM_DESC = /^description:\s*(\S[^\n]*)$/m

interface SessionEntry {
  source: ParsedSkillSource
  skills: DiscoveredSkill[]
  tempDir: string | null
  expiresAt: number
}

const activeSessions = new Map<string, SessionEntry>()

export function parseSkillSource(input: string): ParsedSkillSource {
  input = input.trim()
  if (!input) {
    throw new Error('Source cannot be empty')
  }

  if (isLocalPath(input)) {
    const resolvedPath = resolve(input)
    return { type: 'local', url: resolvedPath, label: resolvedPath }
  }

  const githubTreePath = RE_GITHUB_TREE_PATH.exec(input)
  if (githubTreePath) {
    const [, owner, repo, ref, subpath] = githubTreePath
    return {
      type: 'github',
      url: `https://github.com/${owner}/${repo}.git`,
      ref: ref!,
      subpath: sanitizeSubpath(subpath!),
      label: `${owner}/${repo}`,
    }
  }

  const githubTree = RE_GITHUB_TREE.exec(input)
  if (githubTree) {
    const [, owner, repo, ref] = githubTree
    return { type: 'github', url: `https://github.com/${owner}/${repo}.git`, ref: ref!, label: `${owner}/${repo}` }
  }

  const githubRepo = RE_GITHUB_REPO.exec(input)
  if (githubRepo) {
    const [, owner, repo] = githubRepo
    return { type: 'github', url: `https://github.com/${owner}/${repo}.git`, label: `${owner}/${repo}` }
  }

  const gitlabTreePath = RE_GITLAB_TREE_PATH.exec(input)
  if (gitlabTreePath && gitlabTreePath[2] !== 'github.com') {
    const [, protocol, hostname, repoPath, ref, subpath] = gitlabTreePath
    return {
      type: 'gitlab',
      url: `${protocol}://${hostname}/${repoPath!.replace(RE_GIT_SUFFIX, '')}.git`,
      ref: ref!,
      subpath: sanitizeSubpath(subpath!),
      label: repoPath!,
    }
  }

  const gitlabTree = RE_GITLAB_TREE.exec(input)
  if (gitlabTree && gitlabTree[2] !== 'github.com') {
    const [, protocol, hostname, repoPath, ref] = gitlabTree
    return { type: 'gitlab', url: `${protocol}://${hostname}/${repoPath!.replace(RE_GIT_SUFFIX, '')}.git`, ref: ref!, label: repoPath! }
  }

  const gitlabRepo = RE_GITLAB_REPO.exec(input)
  if (gitlabRepo && gitlabRepo[1]?.includes('/')) {
    return { type: 'gitlab', url: `https://gitlab.com/${gitlabRepo[1]}.git`, label: gitlabRepo[1]! }
  }

  if (input.startsWith('git@')) {
    return { type: 'git', url: input, label: input.replace(RE_SSH_LABEL, '').replace(RE_GIT_SUFFIX, '') }
  }

  const shorthand = RE_SHORTHAND.exec(input)
  if (shorthand && !input.includes(':') && !input.startsWith('.') && !input.startsWith('/')) {
    const [, owner, repo, subpath] = shorthand
    return {
      type: 'github',
      url: `https://github.com/${owner}/${repo!.replace(RE_GIT_SUFFIX, '')}.git`,
      subpath: subpath ? sanitizeSubpath(subpath) : undefined,
      label: `${owner}/${repo}`,
    }
  }

  if (input.startsWith('https://') || input.startsWith('http://')) {
    return { type: 'git', url: input, label: input }
  }

  throw new Error(`Cannot parse skill source: "${input}"`)
}

export async function fetchSkillsFromSource(sourceInput: string): Promise<FetchSessionResult> {
  purgeExpiredSessions()
  const source = parseSkillSource(sourceInput)
  const sessionId = generateSessionId()
  let tempDir: string | null = null
  let searchRoot: string

  if (source.type === 'local') {
    searchRoot = source.url
    if (!fs.existsSync(searchRoot)) {
      throw new Error(`Local path not found: ${searchRoot}`)
    }
  }
  else {
    tempDir = await cloneRepo(source.url, source.ref)
    searchRoot = source.subpath ? path.join(tempDir, source.subpath) : tempDir
    if (!fs.existsSync(searchRoot)) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {})
      throw new Error(`Path not found in repository: ${source.subpath ?? '(root)'}`)
    }
  }

  const skills = await findSkillDirs(searchRoot, searchRoot)
  activeSessions.set(sessionId, { source, skills, tempDir, expiresAt: Date.now() + SESSION_TTL_MS })
  return { sessionId, source, skills, tempDir }
}

export function getFetchSession(sessionId: string): FetchSessionSnapshot | null {
  purgeExpiredSessions()
  const session = activeSessions.get(sessionId)
  if (!session) {
    return null
  }
  return {
    sessionId,
    source: session.source,
    skills: [...session.skills],
    tempDir: session.tempDir,
  }
}

export async function cleanupFetchSession(sessionId: string): Promise<void> {
  const session = activeSessions.get(sessionId)
  if (!session) {
    return
  }
  if (session.tempDir) {
    await rm(session.tempDir, { recursive: true, force: true }).catch(() => {})
  }
  activeSessions.delete(sessionId)
}

function isLocalPath(input: string): boolean {
  return isAbsolute(input) || input.startsWith('./') || input.startsWith('../') || input === '.' || input === '..' || RE_WIN_PATH.test(input)
}

function sanitizeSubpath(subpath: string): string {
  const segments = subpath.replace(RE_BACKSLASH, '/').split('/')
  for (const segment of segments) {
    if (segment === '..') {
      throw new Error(`Unsafe subpath: "${subpath}" contains path traversal`)
    }
  }
  return subpath
}

async function cloneRepo(cloneUrl: string, ref?: string): Promise<string> {
  const tempDir = await mkdtemp(join(os.tmpdir(), 'cradle-skills-'))
  const git = simpleGit({
    timeout: { block: 120_000 },
    config: ['filter.lfs.required=false'],
  })
  git.env('GIT_LFS_SKIP_SMUDGE', '1')
  git.env('GIT_TERMINAL_PROMPT', '0')

  const cloneOptions: string[] = ['--depth', '1']
  if (ref) {
    cloneOptions.push('--branch', ref)
  }

  try {
    await git.clone(cloneUrl, tempDir, cloneOptions)
    return tempDir
  }
  catch (error) {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    const message = error instanceof Error ? error.message : String(error)
    const isAuth = message.includes('Authentication failed')
      || message.includes('Permission denied')
      || message.includes('Repository not found')
      || message.includes('could not read Username')
    if (isAuth) {
      throw new Error(`Authentication failed for ${cloneUrl}. Ensure the repository is public or that you have configured git credentials.`)
    }
    throw new Error(`Failed to clone repository: ${message}`)
  }
}

async function findSkillDirs(dir: string, rootDir: string, depth = 0): Promise<DiscoveredSkill[]> {
  if (depth > 5) {
    return []
  }

  let entries: { name: string, isDirectory: () => boolean }[] = []
  let hasSkill = false
  try {
    const [skillStat, dirEntries] = await Promise.all([
      stat(join(dir, 'SKILL.md')).catch(() => null),
      readdir(dir, { withFileTypes: true }).catch(() => []),
    ])
    hasSkill = skillStat?.isFile() ?? false
    entries = dirEntries
  }
  catch {
    return []
  }

  const results: DiscoveredSkill[] = []
  if (hasSkill) {
    const info = await parseSkillFrontmatter(join(dir, 'SKILL.md'))
    if (info) {
      const relativePath = path.relative(rootDir, dir).replace(RE_BACKSLASH, '/') || '.'
      results.push({ ...info, skillDir: dir, relativePath })
    }
  }

  const nested = await Promise.all(
    entries.filter(entry => entry.isDirectory() && !SKIP_DIRS.has(entry.name)).map(entry => findSkillDirs(join(dir, entry.name), rootDir, depth + 1)),
  )
  results.push(...nested.flat())
  return results
}

async function parseSkillFrontmatter(skillMdPath: string): Promise<{ name: string, description: string } | null> {
  try {
    const content = await readFile(skillMdPath, 'utf8')
    const match = RE_FM_SPLIT.exec(content)
    if (!match) {
      return null
    }
    const block = match[1]
    const nameMatch = RE_FM_NAME.exec(block)
    const descMatch = RE_FM_DESC.exec(block)
    if (!nameMatch || !descMatch) {
      return null
    }
    const name = nameMatch[1].trim().replace(RE_QUOTE_WRAP, '')
    const description = descMatch[1].trim().replace(RE_QUOTE_WRAP, '')
    if (!name || !description) {
      return null
    }
    return { name, description }
  }
  catch {
    return null
  }
}

function purgeExpiredSessions(): void {
  const now = Date.now()
  for (const [id, session] of activeSessions) {
    if (now > session.expiresAt) {
      if (session.tempDir) {
        rm(session.tempDir, { recursive: true, force: true }).catch(() => {})
      }
      activeSessions.delete(id)
    }
  }
}

function generateSessionId(): string {
  return `skill-fetch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
