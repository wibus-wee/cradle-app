import { cn } from '~/lib/cn'

/** Highlighter shell — not a chip (no ring), not bare colored text. */
export const INTENT_MENTION_TOKEN_CLASS
  = 'inline-flex max-w-full select-none items-baseline gap-px rounded-[3px] bg-violet-500/8 px-1 py-0.5 align-baseline text-[0.8125em] leading-none shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] dark:bg-violet-400/12 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'

export const INTENT_MENTION_OPERATOR_CLASS
  = 'shrink-0 font-mono font-normal text-violet-600/50 dark:text-violet-300/45'

export const INTENT_MENTION_OPERAND_CLASS
  = 'min-w-0 truncate font-medium text-violet-800 dark:text-violet-200'

export function normalizeIntentMentionName(name: string): string {
  return name.replace(/^\/+/, '')
}

export function formatIntentMentionTokenLabel(name: string): string {
  return `/${normalizeIntentMentionName(name)}`
}

/** Shared DOM fill for TipTap node views / toDOM-adjacent paths. */
export function fillIntentMentionTokenContent(dom: HTMLElement, name: string): void {
  const label = normalizeIntentMentionName(name)
  const operator = document.createElement('span')
  operator.className = INTENT_MENTION_OPERATOR_CLASS
  operator.setAttribute('aria-hidden', 'true')
  operator.textContent = '/'

  const operand = document.createElement('span')
  operand.className = INTENT_MENTION_OPERAND_CLASS
  operand.textContent = label

  dom.replaceChildren(operator, operand)
}

export function IntentMentionToken({
  name,
  className,
}: {
  name: string
  className?: string
}) {
  const label = normalizeIntentMentionName(name)
  return (
    <span
      className={cn(INTENT_MENTION_TOKEN_CLASS, className)}
      aria-label={formatIntentMentionTokenLabel(label)}
    >
      <span className={INTENT_MENTION_OPERATOR_CLASS} aria-hidden="true">
        /
      </span>
      <span className={INTENT_MENTION_OPERAND_CLASS}>{label}</span>
    </span>
  )
}
