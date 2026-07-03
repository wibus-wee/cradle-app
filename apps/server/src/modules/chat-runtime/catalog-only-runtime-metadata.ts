/**
 * Output: Chat Runtime catalog-only builtin runtime metadata.
 * Input: no runtime data.
 * Position: Chat Runtime metadata owner for runtimes launched outside Provider Runtime.
 */

import type { RuntimeKind } from '../provider-contracts/types'
import type { ChatRuntimeMetadata } from './runtime-provider-types'

export const CLI_TUI_RUNTIME_KIND = 'cli-tui' as const satisfies RuntimeKind

// CLI TUI sessions are launched by session/PTY; the catalog entry only feeds launch selectors.
export const CLI_TUI_RUNTIME_METADATA = {
  label: 'CLI TUI',
  description: 'Launch a configured terminal agent',
  providerKinds: [],
  providerBinding: 'runtime-owned',
  sessionLaunchMode: 'agent-terminal',
  iconKey: 'claude-cli',
  surfaces: ['chat'],
  sortOrder: 60,
  composer: {
    inputMode: 'collapsed',
    modelSelection: 'none',
    thinking: 'unsupported',
  },
} satisfies ChatRuntimeMetadata

export const CATALOG_ONLY_BUILTIN_RUNTIMES: Array<{
  runtimeKind: RuntimeKind
  metadata: ChatRuntimeMetadata
}> = [
  {
    runtimeKind: CLI_TUI_RUNTIME_KIND,
    metadata: CLI_TUI_RUNTIME_METADATA,
  },
]

export const CATALOG_ONLY_BUILTIN_RUNTIME_KINDS = new Set<RuntimeKind>(
  CATALOG_ONLY_BUILTIN_RUNTIMES.map(runtime => runtime.runtimeKind),
)
