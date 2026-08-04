/**
 * Runtime usage composer slot UI.
 *
 * Codex supplies ChatGPT account rate-limit windows through the provider-owned
 * usage slot state; this renderer keeps that account state near the composer.
 */
import { CloseLine as XIcon } from '@mingcute/react'

import type { ChatRuntimeUsageUiSlotState } from '../../capabilities/chat-capabilities'
import { ComposerSlotIconAction, ComposerSlotShell } from './composer-slot-shell'
import type { ComposerUsageSlotActions } from './types'
import { UsageSlotContent } from './usage-slot-content'

export function UsageSlotState({
  state,
  usage,
  className,
}: {
  state: ChatRuntimeUsageUiSlotState
  usage?: ComposerUsageSlotActions
  className?: string
}) {
  return (
    <ComposerSlotShell stateName="usage" className={className}>
      <UsageSlotContent
        state={state}
        action={usage?.open
          ? (
              <ComposerSlotIconAction label="Close usage" onClick={usage.onDismiss}>
                <XIcon className="size-3.5" aria-hidden="true" />
              </ComposerSlotIconAction>
            )
          : undefined}
      />
    </ComposerSlotShell>
  )
}
