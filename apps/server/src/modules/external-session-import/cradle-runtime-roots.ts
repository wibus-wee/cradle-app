import { homedir } from 'node:os'
import { join } from 'node:path'

import { resolveClaudeAgentSdkConfigDir } from '../chat-runtime-providers/claude-agent/runtime-context'
import { resolveCodexAppServerHome } from '../chat-runtime-providers/codex/app-server/runtime-home'
import { listKimiProviderStorageHomes } from '../chat-runtime-providers/kimi/session-storage'

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

export interface KimiImportRoot {
  home: string
  sessions: string
}

export function kimiImportRoot(home: string): KimiImportRoot {
  return { home, sessions: join(home, 'sessions') }
}

/** Kimi Code's home: $KIMI_CODE_HOME, else ~/.kimi-code (mirrors magpie's calls_kimi.go KimiCodeDir). */
export function userKimiCodeHome(input: {
  env?: NodeJS.ProcessEnv
  homeDir?: string
} = {}): string {
  const envHome = (input.env ?? process.env).KIMI_CODE_HOME?.trim()
  if (envHome) {
    return envHome
  }
  return join(input.homeDir ?? homedir(), '.kimi-code')
}

/** User-owned Kimi Code home plus every Cradle-owned kimi runtime provider home. */
export function defaultKimiImportRoots(input: {
  env?: NodeJS.ProcessEnv
  homeDir?: string
} = {}): KimiImportRoot[] {
  const homes = [userKimiCodeHome(input)]
  for (const provider of listKimiProviderStorageHomes()) {
    if (!homes.includes(provider.home)) {
      homes.push(provider.home)
    }
  }
  return homes.map(kimiImportRoot)
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

/**
 * OpenCode's data folder: $XDG_DATA_HOME/opencode, else
 * ~/.local/share/opencode — on Windows too, where OpenCode keeps it there
 * (mirrors magpie internal/sessions/opencode.go OpenCodeDir).
 */
export function userOpenCodeDataDir(input: {
  env?: NodeJS.ProcessEnv
  homeDir?: string
} = {}): string {
  const env = input.env ?? process.env
  const xdg = env.XDG_DATA_HOME
  if (xdg) {
    return join(xdg, 'opencode')
  }
  return join(input.homeDir ?? homedir(), '.local', 'share', 'opencode')
}

/**
 * User-owned OpenCode data directories to scan. Cradle's managed opencode
 * runtime inherits the user's native OpenCode data home instead of owning a
 * separate namespace (unlike claude-agent and codex-app-server), so there is
 * no Cradle-owned OpenCode root to add.
 */
export function defaultOpenCodeImportRoots(input: {
  env?: NodeJS.ProcessEnv
  homeDir?: string
} = {}): string[] {
  return [userOpenCodeDataDir(input)]
}
