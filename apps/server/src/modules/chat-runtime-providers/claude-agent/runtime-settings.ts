import type { RuntimeSettings } from '../../chat-runtime/runtime-provider-types'
import type { ClaudeAgentPermissionMode } from '../../chat-runtime/runtime-settings-registry'

const CLAUDE_AGENT_PERMISSION_MODES = [
  'default',
  'acceptEdits',
  'bypassPermissions',
  'plan',
] as const satisfies readonly ClaudeAgentPermissionMode[]

export function readClaudeAgentPermissionMode(
  settings: RuntimeSettings | null | undefined,
): ClaudeAgentPermissionMode {
  const mode = settings?.permissionMode
  if (typeof mode === 'string' && (CLAUDE_AGENT_PERMISSION_MODES as readonly string[]).includes(mode)) {
    return mode as ClaudeAgentPermissionMode
  }
  return 'default'
}

export function readClaudeAgentAllowDangerouslySkipPermissions(
  settings: RuntimeSettings | null | undefined,
): boolean {
  return readClaudeAgentPermissionMode(settings) !== 'plan'
}
