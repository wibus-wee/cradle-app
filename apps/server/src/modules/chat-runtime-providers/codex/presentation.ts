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
