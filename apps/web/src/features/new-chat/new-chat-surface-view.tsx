import { m } from 'motion/react'
import type { ReactNode } from 'react'

import { DitheredGradientDecoration } from '~/components/ui/canvas-art'

export interface NewChatSurfaceViewProps {
  active: boolean
  ready: boolean
  planMode: boolean
  composer: ReactNode
  quickActions?: ReactNode
  layoutSlots?: ReactNode
  dialog?: ReactNode
  dataTestId?: string
}

/** Props-only New Chat page shell. Session creation and runtime ownership stay in the entry adapter. */
export function NewChatSurfaceView({
  active,
  ready,
  planMode,
  composer,
  quickActions,
  layoutSlots,
  dialog,
  dataTestId = 'new-chat-page',
}: NewChatSurfaceViewProps) {
  return (
    <div
      className="relative flex h-full min-h-[36rem] flex-col bg-background"
      data-testid={dataTestId}
      data-new-chat-ready={ready ? 'true' : 'false'}
    >
      {layoutSlots}
      <m.div
        className="pointer-events-none"
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.3 }}
        transition={{ duration: 1.2, ease: [0.25, 0.1, 0.25, 1] }}
      >
        <DitheredGradientDecoration
          rows={35}
          density={0.4}
          glowRadius={140}
          trackGlobal
          active={active}
          tone={planMode ? 'plan' : 'neutral'}
        />
      </m.div>
      <div className="relative flex flex-1 flex-col items-center justify-center px-6 pb-4">
        <m.div
          className="w-full max-w-160"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: [0.25, 0.1, 0.25, 1] }}
        >
          {composer}
          {quickActions}
        </m.div>
      </div>
      {dialog}
    </div>
  )
}
