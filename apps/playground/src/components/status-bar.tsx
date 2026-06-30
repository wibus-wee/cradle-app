import type { SmoothPreset } from '@cradle/streamdown'

interface StatusBarProps {
  streaming: boolean
  cps: number
  elapsed: number
  charsRevealed: number
  totalChars: number
  preset: SmoothPreset
  animateMode: 'char' | 'word'
}

export function StatusBar({
  streaming,
  cps,
  elapsed,
  charsRevealed,
  totalChars,
  preset,
  animateMode,
}: StatusBarProps) {
  const progress = totalChars > 0 ? Math.round((charsRevealed / totalChars) * 100) : 0

  return (
    <div className="flex h-8 items-center gap-4 border-t border-border px-4 text-xs text-muted-foreground font-mono shrink-0">
      <div className="flex items-center gap-1.5">
        <span
          className={`inline-block size-1.5 rounded-full ${
            streaming
              ? 'bg-emerald-500 shadow-[0_0_4px_var(--color-emerald-500)]'
              : charsRevealed > 0
                ? 'bg-foreground/40'
                : 'bg-foreground/20'
          }`}
        />
        <span>{streaming ? 'Streaming' : charsRevealed > 0 ? 'Complete' : 'Ready'}</span>
      </div>

      <div className="h-3 w-px bg-border" />

      <span>
        CPS:
        {' '}
        <span className="text-foreground tabular-nums">{cps}</span>
      </span>

      <span>
        Elapsed:
        {' '}
        <span className="text-foreground tabular-nums">
{(elapsed / 1000).toFixed(1)}
s
        </span>
      </span>

      <span>
        Chars:
        {' '}
        <span className="text-foreground tabular-nums">{charsRevealed}</span>
        /
        <span className="tabular-nums">{totalChars}</span>
      </span>

      {totalChars > 0 && (
        <div className="flex items-center gap-1.5">
          <div className="h-1 w-16 rounded-full bg-foreground/15 overflow-hidden">
            <div
              className="h-full rounded-full bg-foreground/40 transition-all duration-150"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="tabular-nums">
{progress}
%
          </span>
        </div>
      )}

      <div className="ml-auto flex items-center gap-3">
        <span className="capitalize">{preset}</span>
        <span>{animateMode === 'word' ? 'Word' : 'Char'}</span>
      </div>
    </div>
  )
}
