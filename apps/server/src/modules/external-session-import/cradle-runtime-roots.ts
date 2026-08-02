import { homedir } from 'node:os'
import { join } from 'node:path'

import { resolveClaudeAgentSdkConfigDir } from '../chat-runtime-providers/claude-agent/runtime-context'
import { resolveCodexAppServerHome } from '../chat-runtime-providers/codex/app-server/runtime-home'

export interface CodexImportRootSet {
  roots: {
    current: string
    archived: string
  }
  sessionIndex: string
  history: string
}

function userCodexHome(homeDir?: string): string {
  return join(homeDir ?? homedir(), '.codex')
}

export function codexImportRootSet(home: string): CodexImportRootSet {
  return {
    roots: {
      current: join(home, 'sessions'),
      archived: join(home, 'archived_sessions'),
    },
    sessionIndex: join(home, 'session_index.jsonl'),
    history: join(home, 'history.jsonl'),
  }
}

/** User-owned Codex CLI home plus Cradle-owned codex-app-server runtime data. */
export function defaultCodexImportRootSets(input: {
  env?: NodeJS.ProcessEnv
  homeDir?: string
} = {}): CodexImportRootSet[] {
  const homeDir = input.homeDir
  const sets = [codexImportRootSet(userCodexHome(homeDir))]
  const cradleHome = resolveCodexAppServerHome(input)
  if (cradleHome !== userCodexHome(homeDir)) {
    sets.push(codexImportRootSet(cradleHome))
  }
  return sets
}

/** User-owned Claude projects root plus Cradle-owned claude-agent SDK config projects. */
export function defaultClaudeImportRoots(input: {
  env?: NodeJS.ProcessEnv
  homeDir?: string
} = {}): string[] {
  const homeDir = input.homeDir
  const userRoot = join(homeDir ?? homedir(), '.claude', 'projects')
  const cradleRoot = join(resolveClaudeAgentSdkConfigDir(input), 'projects')
  if (cradleRoot === userRoot) {
    return [userRoot]
  }
  return [userRoot, cradleRoot]
}
