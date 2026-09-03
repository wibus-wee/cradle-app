import { existsSync, readdirSync, rmSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'

import { resolveClaudeAgentSdkConfigDir } from './runtime-context'

export function deleteClaudeAgentSessionStorage(providerSessionId: string): boolean {
  const runtimeHome = resolve(resolveClaudeAgentSdkConfigDir())
  const projects = join(runtimeHome, 'projects')
  if (!existsSync(projects)) {
    return false
  }

  for (const project of readdirSync(projects, { withFileTypes: true })) {
    if (!project.isDirectory()) {
      continue
    }
    const transcript = resolve(projects, project.name, `${providerSessionId}.jsonl`)
    const containedPath = relative(runtimeHome, transcript)
    if (!containedPath || containedPath.startsWith('..') || isAbsolute(containedPath)) {
      continue
    }
    if (existsSync(transcript)) {
      rmSync(transcript, { force: true })
      return true
    }
  }
  return false
}
