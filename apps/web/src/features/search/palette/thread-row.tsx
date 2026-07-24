import { Message1Line } from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { CommandItem } from '~/components/ui/command'
import { HighlightedText } from '~/features/search/highlighted-text'
import type { ThreadSearchHit } from '~/features/search/types'

export interface ThreadRowProps {
  data: ThreadSearchHit
  onSelect: (sessionId: string) => void
}

export function ThreadRow({ data: thread, onSelect }: ThreadRowProps) {
  const { t } = useTranslation('search')
  const title = thread.sessionTitle ?? thread.snippets[0]?.text ?? ''
  const snippet = thread.snippets[0]

  return (
    <CommandItem
      value={`thread-${thread.sessionId}`}
      onSelect={() => onSelect(thread.sessionId)}
      className="py-1"
      data-testid={`global-search-thread-result-${thread.sessionId}`}
    >
      <Message1Line className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className="truncate text-[13px]"
          data-testid={`global-search-thread-title-${thread.sessionId}`}
        >
          <HighlightedText text={title} ranges={thread.titleRanges} />
        </span>
        {snippet
          ? (
              <span
                className="truncate text-[11px] text-muted-foreground/55"
                data-testid={`global-search-thread-snippet-${thread.sessionId}`}
              >
                <HighlightedText text={snippet.text} ranges={snippet.ranges} />
              </span>
            )
          : (
              <span className="text-[11px] text-muted-foreground/50">
                {t('thread.match.titleOnly')}
              </span>
            )}
      </span>
    </CommandItem>
  )
}
