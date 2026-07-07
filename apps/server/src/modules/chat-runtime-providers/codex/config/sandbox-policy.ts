import type { CodexConfig } from '../../../provider-contracts/provider-base'
import type { SandboxPolicy } from '../app-server-protocol/v2/SandboxPolicy'

/**
 * Build a Codex app-server sandbox policy from the runtime sandbox mode and
 * writable roots. Shared by streamTurn, title generation, shell command, etc.
 */
export function toSandboxPolicy(
  sandboxMode: CodexConfig['sandboxMode'],
  writableRoots: string[],
  additionalDirectories: string[],
): SandboxPolicy {
  if (sandboxMode === 'danger-full-access') {
    return { type: 'dangerFullAccess' }
  }
  if (sandboxMode === 'read-only') {
    return { type: 'readOnly', networkAccess: false }
  }
  return {
    type: 'workspaceWrite',
    writableRoots: [...new Set([...writableRoots, ...additionalDirectories])],
    networkAccess: false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  }
}
