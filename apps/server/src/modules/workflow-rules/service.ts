import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { AppError } from '../../errors/app-error'
import { getServerConfig } from '../../infra'

// ── types ──

export interface WorkflowRules {
  global: string | null
  agentSpecific: string | null
}

export interface WorkflowRuleEntry {
  type: 'global' | 'agent'
  agentId: string | null
  content: string
}

// ── helpers ──

const UNSAFE_ID_RE = /[/\\]|\.\./
const MD_EXT_RE = /\.md$/

function getRootDir(): string {
  const config = getServerConfig()
  const baseDir = config.dataDir ?? dirname(config.dbPath)
  return join(baseDir, 'workflow-rules')
}

function assertSafeId(value: string, field: string): void {
  if (!value || UNSAFE_ID_RE.test(value)) {
    throw new AppError({
      code: 'invalid_workflow_rule_id',
      status: 400,
      message: `${field} is invalid`,
      details: { field, value },
    })
  }
}

function getWorkspaceRoot(workspaceId: string): string {
  assertSafeId(workspaceId, 'workspaceId')
  return join(getRootDir(), workspaceId)
}

function getGlobalRulePath(workspaceId: string): string {
  return join(getWorkspaceRoot(workspaceId), 'rules.md')
}

function getAgentRulePath(workspaceId: string, agentId: string): string {
  assertSafeId(agentId, 'agentId')
  return join(getWorkspaceRoot(workspaceId), 'agents', `${agentId}.md`)
}

async function readOptionalFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8')
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
}

// ── public API ──

export async function get(workspaceId: string, agentId?: string | null): Promise<WorkflowRules> {
  const globalPath = getGlobalRulePath(workspaceId)
  const agentPath = agentId ? getAgentRulePath(workspaceId, agentId) : null

  return {
    global: await readOptionalFile(globalPath),
    agentSpecific: agentPath ? await readOptionalFile(agentPath) : null,
  }
}

export async function save(workspaceId: string, agentId: string | null, content: string): Promise<void> {
  const filePath = agentId
    ? getAgentRulePath(workspaceId, agentId)
    : getGlobalRulePath(workspaceId)

  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf8')
}

export async function remove(workspaceId: string, agentId: string | null): Promise<void> {
  const filePath = agentId
    ? getAgentRulePath(workspaceId, agentId)
    : getGlobalRulePath(workspaceId)

  try {
    await unlink(filePath)
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }
}

export async function list(workspaceId: string): Promise<WorkflowRuleEntry[]> {
  const entries: WorkflowRuleEntry[] = []
  const globalContent = await readOptionalFile(getGlobalRulePath(workspaceId))
  if (globalContent !== null) {
    entries.push({ type: 'global', agentId: null, content: globalContent })
  }

  const agentsDir = join(getWorkspaceRoot(workspaceId), 'agents')
  let files: string[] = []
  try {
    files = await readdir(agentsDir)
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }

  for (const file of files.filter(f => f.endsWith('.md')).sort()) {
    const content = await readOptionalFile(join(agentsDir, file))
    if (content === null) {
      continue
    }
    entries.push({
      type: 'agent',
      agentId: file.replace(MD_EXT_RE, ''),
      content,
    })
  }

  return entries
}
