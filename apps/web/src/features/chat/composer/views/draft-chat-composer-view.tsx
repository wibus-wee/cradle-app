import type { ReactNode } from 'react'

export interface DraftChatComposerViewProps {
  composer: ReactNode
  composerState?: ReactNode
  notice?: ReactNode
}

/** Props-only New Chat composition surface; runtime modules provide all slots. */
export function DraftChatComposerView({
  composer,
  composerState,
  notice,
}: DraftChatComposerViewProps) {
  return (
    <>
      {composerState}
      {composer}
      {notice}
    </>
  )
}
