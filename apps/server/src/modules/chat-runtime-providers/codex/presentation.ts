/**
 * Output: Codex runtime presentation projection.
 * Input: generated Codex app-server capability manifest (+ optional config requirements).
 * Position: Codex provider package boundary from app-server capabilities to Chat Runtime presentation.
 */

import type { RuntimePresentationCapabilities } from '../../chat-runtime/runtime-provider-types'
import { CODEX_APP_SERVER_CAPABILITIES } from './app-server/capabilities'
import { CODEX_RUNTIME_KIND } from './metadata'
import {
  applyCodexConfigRequirementSlotGates,
  projectCodexUiSlots,
} from './projection/ui-slot-projector'
import type { CodexConfigRequirementsReadResponse } from './types'

export function createCodexRuntimePresentation(
  requirements?: CodexConfigRequirementsReadResponse['requirements'] | null,
): RuntimePresentationCapabilities {
  return {
    runtimeKind: CODEX_RUNTIME_KIND,
    slashCommands: [],
    uiSlots: applyCodexConfigRequirementSlotGates(
      projectCodexUiSlots(CODEX_APP_SERVER_CAPABILITIES),
      requirements,
    ),
    skills: [],
  }
}
