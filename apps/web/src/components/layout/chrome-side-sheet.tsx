import { CloseLine as XIcon } from '@mingcute/react'
import type { CSSProperties, ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

import { Button } from '~/components/ui/button'
import { cn } from '~/lib/cn'

interface ChromeSideSheetProps {
  children: ReactNode
  closeLabel: string
  className?: string
  contentTestId?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  side: 'left' | 'right'
  title: string
}

export function ChromeSideSheet({
  children,
  closeLabel,
  className,
  contentTestId,
  open,
  onOpenChange,
  side,
  title,
}: ChromeSideSheetProps) {
  const panelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      const panel = panelRef.current
      const target = event.target
      const trigger = target instanceof Element
        ? target.closest('[data-chrome-side-sheet-trigger]')
        : null

      if (
        !panel
        || (target instanceof Node && panel.contains(target))
        || trigger?.getAttribute('data-chrome-side-sheet-trigger') === side
      ) {
        return
      }

      onOpenChange(false)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onOpenChange(false)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown, { capture: true })
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, { capture: true })
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onOpenChange, open, side])

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div
      ref={panelRef}
      aria-hidden={open ? undefined : true}
      aria-label={title}
      data-open={open ? 'true' : 'false'}
      data-side={side}
      data-testid={contentTestId}
      inert={open ? undefined : true}
      role="dialog"
      className={cn(
        'fixed bottom-1 top-12 z-50 flex w-[min(20rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl bg-sidebar pt-9 text-sidebar-foreground shadow-[var(--shadow-sm)] outline-none',
        'transition-[transform,opacity] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform [contain:layout_paint_style]',
        {
          'left-1': side === 'left',
          'right-1': side === 'right',
          'translate-x-0 opacity-100': open,
          'pointer-events-none translate-x-[calc(-100%-0.5rem)] opacity-0': !open && side === 'left',
          'pointer-events-none translate-x-[calc(100%+0.5rem)] opacity-0': !open && side === 'right',
        },
        className,
      )}
    >
      <span className="sr-only">{title}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={closeLabel}
        title={closeLabel}
        onClick={() => onOpenChange(false)}
        className={cn(
          'absolute top-2 z-20 text-muted-foreground',
          {
            'right-2': side === 'left',
            'left-2': side === 'right',
          },
        )}
        style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
      >
        <XIcon aria-hidden="true" />
      </Button>
      {children}
    </div>,
    document.body,
  )
}
