import { Streamdown } from '@cradle/streamdown'
import { useId, useState } from 'react'

import { Button } from '~/components/ui/button'
import { cn } from '~/lib/cn'
import { STREAMDOWN_RENDER_OPTIONS } from '~/store/streamdown'

interface ReasoningBlockProps {
  text: string
  state?: 'streaming' | 'done'
}

function BrainSvg({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a7 7 0 0 0-7 7c0 2.38 1.19 4.47 3 5.74V17a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2.26c1.81-1.27 3-3.36 3-5.74a7 7 0 0 0-7-7z" />
      <path d="M9 21h6" />
      <path d="M10 17v4" />
      <path d="M14 17v4" />
      <path d="M8.5 10c0-1 .5-2 1.5-2.5" />
      <path d="M15.5 10c0-1-.5-2-1.5-2.5" />
    </svg>
  )
}

export function ReasoningBlock({ text, state = 'done' }: ReasoningBlockProps) {
  const [expanded, setExpanded] = useState(false)
  const contentId = useId()

  return (
    <div className="py-2">
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-controls={contentId}
        data-testid="chat-reasoning-toggle"
        className={cn(
          'h-auto gap-1.5 p-0 text-xs hover:bg-transparent',
          expanded ? 'text-muted-foreground' : 'text-muted-foreground/60 hover:text-muted-foreground',
        )}
      >
        <BrainSvg
          className={cn(
            'size-4',
            state === 'streaming' && 'animate-pulse',
            state === 'done' && 'opacity-60 hover:opacity-100',
          )}
        />
        <span>Thinking</span>
      </Button>

      {expanded && (
        <div
          id={contentId}
          className="overflow-hidden"
          data-testid="chat-reasoning-content"
        >
          <div className="relative pt-2 pl-5">
            <div className="text-sm max-h-82 overflow-y-auto leading-relaxed opacity-50 before:absolute before:top-0 before:left-0 before:h-full before:w-0.5 before:bg-linear-to-b before:from-transparent before:via-muted-foreground/50 before:to-transparent">
              <Streamdown
                content={text}
                streaming={state === 'streaming'}
                animationPreset={STREAMDOWN_RENDER_OPTIONS.animationPreset}
                animateMode={STREAMDOWN_RENDER_OPTIONS.animateMode}
                showCursor={STREAMDOWN_RENDER_OPTIONS.showCursor}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
