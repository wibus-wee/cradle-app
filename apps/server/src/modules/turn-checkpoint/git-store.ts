import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHECKPOINT_AUTHOR_ENV = {
  GIT_AUTHOR_NAME: 'Cradle',
  GIT_AUTHOR_EMAIL: 'cradle@users.noreply.github.com',
  GIT_COMMITTER_NAME: 'Cradle',
  GIT_COMMITTER_EMAIL: 'cradle@users.noreply.github.com',
}

interface GitResult {
  code: number
  stdout: string
  stderr: string
}

async function runGit(
  cwd: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv, allowNonZero?: boolean } = {},
): Promise<GitResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.on('error', reject)
    child.on('close', (code) => {
      const result = {
        code: code ?? 0,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      }
      if (result.code === 0 || options.allowNonZero) {
        resolve(result)
        return
      }
      reject(new Error(result.stderr.trim() || `git ${args[0] ?? 'command'} exited with ${result.code}`))
    })
  })
}

export async function isGitWorkspace(cwd: string): Promise<boolean> {
  const result = await runGit(cwd, ['rev-parse', '--is-inside-work-tree'], { allowNonZero: true })
  return result.code === 0 && result.stdout.trim() === 'true'
}

async function resolveRef(cwd: string, ref: string): Promise<string | null> {
  const result = await runGit(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
    allowNonZero: true,
  })
  return result.code === 0 && result.stdout.trim() ? result.stdout.trim() : null
}

export async function captureCheckpoint(cwd: string, ref: string): Promise<void> {
  const existing = await resolveRef(cwd, ref)
  if (existing) {
    return
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'cradle-turn-checkpoint-'))
  const tempIndex = join(tempDir, `index-${randomUUID()}`)
  const env = { ...process.env, ...CHECKPOINT_AUTHOR_ENV, GIT_INDEX_FILE: tempIndex }
  try {
    const head = await runGit(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], {
      allowNonZero: true,
    })
    if (head.code === 0) {
      await runGit(cwd, ['read-tree', 'HEAD'], { env })
    }
    await runGit(cwd, ['add', '-A', '--', '.'], { env })
    const tree = (await runGit(cwd, ['write-tree'], { env })).stdout.trim()
    if (!tree) {
      throw new Error('git write-tree returned an empty tree id')
    }
    const commit = (await runGit(cwd, ['commit-tree', tree, '-m', `Cradle turn checkpoint ${ref}`], { env })).stdout.trim()
    if (!commit) {
      throw new Error('git commit-tree returned an empty commit id')
    }
    await runGit(cwd, ['update-ref', ref, commit])
  }
  finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

export async function summarizeCheckpointDiff(
  cwd: string,
  startRef: string,
  endRef: string,
): Promise<{ changedFiles: number, additions: number, deletions: number }> {
  const output = (await runGit(cwd, ['diff', '--numstat', '--no-renames', startRef, endRef])).stdout
  let changedFiles = 0
  let additions = 0
  let deletions = 0
  for (const line of output.split('\n')) {
    if (!line.trim()) {
      continue
    }
    const [added, deleted] = line.split('\t')
    changedFiles += 1
    if (added !== '-') {
      additions += Number.parseInt(added ?? '0', 10) || 0
    }
    if (deleted !== '-') {
      deletions += Number.parseInt(deleted ?? '0', 10) || 0
    }
  }
  return { changedFiles, additions, deletions }
}

export async function restoreCheckpoint(cwd: string, ref: string): Promise<boolean> {
  const commit = await resolveRef(cwd, ref)
  if (!commit) {
    return false
  }
  await runGit(cwd, ['restore', '--source', commit, '--worktree', '--staged', '--', '.'])
  await runGit(cwd, ['clean', '-fd', '--', '.'])
  const head = await runGit(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], {
    allowNonZero: true,
  })
  if (head.code === 0) {
    await runGit(cwd, ['reset', '--quiet', '--', '.'])
  }
  return true
}

export async function deleteCheckpointRefs(cwd: string, refs: string[]): Promise<void> {
  for (const ref of refs) {
    await runGit(cwd, ['update-ref', '-d', ref])
  }
}
