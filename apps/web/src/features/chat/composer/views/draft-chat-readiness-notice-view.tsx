import { m } from 'motion/react'

import { Button } from '~/components/ui/button'

import type { DraftChatReadinessNotice } from '../lib/draft-chat-composer-types'

export interface DraftChatReadinessNoticeViewProps {
  notice: DraftChatReadinessNotice | null
  onAction: (section: string) => void
  testIdPrefix: string
}

export function DraftChatReadinessNoticeView({
  notice,
  onAction,
  testIdPrefix,
}: DraftChatReadinessNoticeViewProps) {
  if (!notice) {
    return null
  }

  const NoticeIcon = notice.icon

  return (
    <m.div
      className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-muted/35 px-3 py-2 text-[12px] text-muted-foreground"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      data-testid={`${testIdPrefix}-readiness-notice`}
    >
      <NoticeIcon className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden />
      <span className="min-w-0 flex-1 leading-relaxed">{notice.message}</span>
      <Button
        type="button"
        size="xs"
        variant="outline"
        onClick={() => onAction(notice.key)}
        disabled={notice.disabled}
        className="h-7 shrink-0"
      >
        {notice.actionLabel}
      </Button>
    </m.div>
  )
}
