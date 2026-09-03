import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { deleteClaudeAgentSessionStorage } from './session-storage'

const previousDataDir = process.env.CRADLE_DATA_DIR
let dataDir: string | null = null

afterEach(() => {
  if (dataDir) {
    rmSync(dataDir, { recursive: true, force: true })
    dataDir = null
  }
  if (previousDataDir === undefined) {
    delete process.env.CRADLE_DATA_DIR
  }
  else {
    process.env.CRADLE_DATA_DIR = previousDataDir
  }
})

describe('claude-agent session storage', () => {
  it('deletes only the matching parent transcript in the Cradle runtime home', () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cradle-claude-session-storage-'))
    process.env.CRADLE_DATA_DIR = dataDir
    const projectDirectory = join(dataDir, 'runtimes', 'claude-agent', 'projects', 'project-a')
    const transcript = join(projectDirectory, 'provider-session.jsonl')
    const otherTranscript = join(projectDirectory, 'other-session.jsonl')
    const subagentTranscript = join(projectDirectory, 'provider-session', 'subagents', 'agent.jsonl')
    mkdirSync(join(projectDirectory, 'provider-session', 'subagents'), { recursive: true })
    writeFileSync(transcript, '{}\n')
    writeFileSync(otherTranscript, '{}\n')
    writeFileSync(subagentTranscript, '{}\n')

    expect(deleteClaudeAgentSessionStorage('provider-session')).toBe(true)
    expect(existsSync(transcript)).toBe(false)
    expect(existsSync(otherTranscript)).toBe(true)
    expect(existsSync(subagentTranscript)).toBe(true)
  })
})
