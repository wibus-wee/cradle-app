/**
 * Output: Codex runtime presentation projection.
 * Input: generated Codex app-server capability manifest.
 * Position: Codex provider package boundary from app-server capabilities to Chat Runtime presentation.
 */

import type { RuntimePresentationCapabilities } from '../../chat-runtime/runtime-provider-types'
import { CODEX_APP_SERVER_CAPABILITIES } from './app-server/capabilities'
import { CODEX_RUNTIME_KIND } from './metadata'
import { projectCodexUiSlots } from './projection/ui-slot-projector'

export function createCodexRuntimePresentation(): RuntimePresentationCapabilities {
  return {
    runtimeKind: CODEX_RUNTIME_KIND,
    slashCommands: [],
    uiSlots: projectCodexUiSlots(CODEX_APP_SERVER_CAPABILITIES),
    skills: [],
  }
}
