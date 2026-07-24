import {
  ClockLine as ClockIcon,
  Message1Line as MessageSquareIcon,
} from '@mingcute/react'
import { m } from 'motion/react'

export interface NewChatRecentSession {
  id: string
  title: string
  relativeTimeLabel: string
}

export interface NewChatRecentSessionsViewProps {
  title: string
  sessions: NewChatRecentSession[]
  onResume: (sessionId: string) => void
}

/** Props-only recent session grid for New Chat and other session entry surfaces. */
export function NewChatRecentSessionsView({
  title,
  sessions,
  onResume,
}: NewChatRecentSessionsViewProps) {
  if (sessions.length === 0) {
    return null
  }

  return (
    <m.div
      className="relative"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.2, duration: 0.25 }}
    >
      <div className="mx-auto max-w-160 px-6 py-4">
        <div className="mb-2.5 flex items-center gap-1.5">
          <ClockIcon className="size-3 !text-muted-foreground/50" aria-hidden="true" />
          <span className="select-none text-[11px] text-muted-foreground/50">{title}</span>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {sessions.map((session, index) => (
            <m.button
              key={session.id}
              type="button"
              onClick={() => onResume(session.id)}
              className="group flex flex-col items-start gap-1.5 rounded-xl border border-border px-3.5 py-3 text-left transition-colors duration-150 hover:border-border hover:bg-accent"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + index * 0.04, duration: 0.22 }}
            >
              <div className="flex w-full items-center gap-2">
                <MessageSquareIcon className="size-3 shrink-0 !text-muted-foreground/50 transition-colors group-hover:!text-muted-foreground/70" aria-hidden="true" />
                <span className="flex-1 truncate text-[13px] text-foreground">
                  {session.title}
                </span>
              </div>
              <time className="text-[11px] text-muted-foreground/50 transition-colors group-hover:text-muted-foreground/70">
                {session.relativeTimeLabel}
              </time>
            </m.button>
          ))}
        </div>
      </div>
    </m.div>
  )
}
