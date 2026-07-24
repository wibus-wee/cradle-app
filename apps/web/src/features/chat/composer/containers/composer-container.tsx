import { useMemo } from 'react'

import { isLocalMode } from '~/lib/electron'

import type { ComposerAttachmentIntegration, ComposerProps } from '../views/composer-view'
import { ComposerView } from '../views/composer-view'

export { ComposerView }
export type {
  ComposerAccessibilityOptions,
  ComposerAttachmentIntegration,
  ComposerCommandController,
  ComposerDecoration,
  ComposerExternalSignals,
  ComposerProps,
  ComposerRuntimeSettingsController,
  ComposerSendController,
  ComposerSendHandler,
  ComposerSendVariant,
  ComposerSlots,
  ComposerTestIds,
  ComposerViewOptions,
} from '../views/composer-view'

/** Runtime adapter that supplies host capabilities to the props-driven ComposerView. */
export function Composer({ attachments, ...props }: ComposerProps) {
  const runtimeAttachments = useMemo<ComposerAttachmentIntegration | undefined>(() => {
    if (!attachments) {
      return undefined
    }
    return {
      ...attachments,
      acceptsNativeFiles: attachments.acceptsNativeFiles ?? isLocalMode(),
    }
  }, [attachments])

  return <ComposerView {...props} attachments={runtimeAttachments} />
}
