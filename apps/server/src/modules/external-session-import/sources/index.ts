import { createClaudeSessionSource } from './claude'
import { createCodexSessionSource } from './codex'
import { createKimiSessionSource } from './kimi'
import { createOpenCodeSessionSource } from './opencode'

export function createExternalSessionSources() {
  return [
    createClaudeSessionSource(),
    createCodexSessionSource(),
    createKimiSessionSource(),
    createOpenCodeSessionSource(),
  ] as const
}
