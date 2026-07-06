import { CheckCircleLine as CheckCircle2Icon } from '@mingcute/react'

import { Badge } from '~/components/ui/badge'
import { cn } from '~/lib/cn'

import type { CredentialMetadata } from './use-credential-metadata'

export function ChatgptCredentialSummary({
  credential,
  className,
}: {
  credential: CredentialMetadata
  className?: string
}) {
  const account = credential.chatgpt
  return (
    <div
      className={cn(
        'rounded-lg bg-muted/45 px-3 py-2.5 ring-1 ring-foreground/8',
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          <CheckCircle2Icon className="size-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[11px] font-medium text-muted-foreground">
              ChatGPT account
            </span>
            {account?.chatgptPlanType && (
              <Badge variant="secondary" className="h-5 shrink-0 px-1.5 text-[10px] font-medium uppercase">
                {account.chatgptPlanType}
              </Badge>
            )}
          </div>
          <div className="mt-1 truncate font-mono text-[12px] text-foreground">
            {account?.chatgptAccountId ?? credential.maskedSecret}
          </div>
          <div className="mt-1 truncate text-[11px] text-muted-foreground">
            {credential.label}
          </div>
        </div>
      </div>
    </div>
  )
}
