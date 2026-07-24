import { Message1Line } from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { CommandItem } from '~/components/ui/command'

import type { RecentConversation } from './types'

export interface RecentConversationRowProps {
  data: RecentConversation
  onSelect: (sessionId: string) => void
}

export function RecentConversationRow({
  data: conversation,
  onSelect,
}: RecentConversationRowProps) {
  const { t } = useTranslation('search')

  return (
    <CommandItem
      value={`recent-thread-${conversation.id}`}
      onSelect={() => onSelect(conversation.id)}
      className="py-0.5"
      data-testid={`global-search-recent-conversation-${conversation.id}`}
    >
      <Message1Line className="size-4 shrink-0 text-muted-foreground/65" />
      <span className="min-w-0 flex-1 truncate text-[13px]">
        {conversation.title || t('thread.untitled')}
      </span>
    </CommandItem>
  )
}
