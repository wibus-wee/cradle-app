// Renders persisted Composer bang command results as terminal-style chat context.
import { RightSmallLine as ChevronRightIcon, TerminalBoxLine as SquareTerminalIcon } from '@mingcute/react'
import { useState } from 'react'

import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { cn } from '~/lib/cn'
import { formatShortDurationMs } from '~/lib/number-format'

import type { BangCommandMetadata, BangResultMetadata } from '../../commands/bang-command-metadata'
import { readTerminalOutputSections } from '../terminal-tool-details'
import type { ToolPayload } from '../tool-ui-classifier'

export function BangCommandPromptBlock({ command }: BangCommandMetadata) {
  return (
    <div
      className="flex min-w-0 items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-left font-mono text-xs text-zinc-50 shadow-xs"
      data-testid="chat-bang-command-prompt"
    >
      <SquareTerminalIcon className="size-4 shrink-0 !text-emerald-300" aria-hidden="true" />
      <span className="shrink-0 text-emerald-300">$</span>
      <span className="min-w-0 truncate">{command}</span>
    </div>
  )
}

export function BangCommandBlock({ result }: { result: BangResultMetadata }) {
  const [expanded, setExpanded] = useState(() => result.exitCode !== 0 || result.timedOut)
  const sections = readTerminalOutputSections({
    stdout: result.stdout,
    stderr: result.stderr,
  } as ToolPayload)
  const exitLabel = result.timedOut ? 'timeout' : `exit ${result.exitCode ?? '?'}`
  const ok = !result.timedOut && result.exitCode === 0

  return (
    <div className="grid min-w-0 gap-2 rounded-lg border border-border/60 bg-background/70 p-2.5 text-left shadow-xs">
      <Button
        type="button"
        variant="ghost"
        aria-expanded={expanded}
        onClick={() => setExpanded(value => !value)}
        className="h-auto min-w-0 justify-start gap-2 px-1 py-0.5 text-left hover:bg-transparent"
      >
        <SquareTerminalIcon className="size-4 shrink-0 !text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
          {result.command}
        </span>
        <Badge
          variant={ok ? 'outline' : 'destructive'}
          className={cn(
            'h-5 px-1.5 font-mono text-[10px] tabular-nums',
            ok && 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
          )}
        >
          {exitLabel}
        </Badge>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
          {formatShortDurationMs(result.durationMs)}
        </span>
        <ChevronRightIcon
          className={cn('size-3.5 shrink-0 !text-muted-foreground transition-transform', expanded && 'rotate-90')}
          aria-hidden="true"
        />
      </Button>

      {expanded && (
        <div className="grid gap-2">
          {sections.length === 0
            ? (
                <div className="rounded-md bg-muted/35 px-2.5 py-2 font-mono text-xs text-muted-foreground">
                  Command produced no output.
                </div>
              )
            : sections.map(section => (
                <section key={section.label} className="grid gap-1">
                  {sections.length > 1 && (
                    <div className={cn(
                      'px-0.5 font-mono text-[10px] font-medium',
                      section.destructive ? 'text-destructive/75' : 'text-muted-foreground/65',
                    )}
                    >
                      {section.label}
                    </div>
                  )}
                  <pre
                    className={cn(
                      'max-h-56 overflow-auto rounded-md border px-2.5 py-2 font-mono text-xs leading-relaxed whitespace-pre text-foreground/85',
                      section.destructive
                        ? 'border-destructive/20 bg-destructive/5 text-destructive/90'
                        : 'border-border/60 bg-muted/30',
                    )}
                  >
                    {section.text}
                  </pre>
                </section>
              ))}
          {result.truncated && (
            <div className="text-[11px] text-muted-foreground">
              Output truncated.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
