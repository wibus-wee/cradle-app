import type { ChatFileLineCommentContextMessagePart } from '../../context/chat-context-parts'
import { readFileLineCommentContextLabel, readFileLineCommentContextPart } from '../../context/chat-context-parts'

export interface FileLineCommentContextViewProps { part: ChatFileLineCommentContextMessagePart }

export function FileLineCommentContextView({ part }: FileLineCommentContextViewProps) {
  const comment = readFileLineCommentContextPart(part)
  return comment
? (
<span className="mx-0.5 inline-flex max-w-full flex-col rounded-lg bg-[var(--color-accent-scope)]/10 px-2 py-1.5 text-xs text-[var(--text-primary)] shadow-[var(--shadow-inset-ring)]">
<span className="truncate font-mono text-[10px] text-[var(--color-accent-scope)]">{readFileLineCommentContextLabel(comment)}</span>
<span className="whitespace-pre-wrap">{comment.comment}</span>
</span>
)
: null
}
