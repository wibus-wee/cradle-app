import { useCallback, useEffect, useRef } from 'react'

import { cn } from '~/lib/cn'

export type CaptionButtonId = 'minimize' | 'maximize' | 'close'

export interface CaptionButtonRect {
  button: CaptionButtonId
  x: number
  y: number
  width: number
  height: number
}

export interface CaptionButtonLabels {
  minimize: string
  maximize: string
  restore: string
  close: string
}

interface WindowsCaptionButtonsViewProps {
  maximized: boolean
  hoveredButton: CaptionButtonId | null
  pressedButton: CaptionButtonId | null
  labels: CaptionButtonLabels
  onRectsChange: (rects: CaptionButtonRect[]) => void
  onButtonClick: (button: CaptionButtonId) => void
}

const GLYPH_FONT = '\'Segoe Fluent Icons\', \'Segoe MDL2 Assets\''
const BUTTON_WIDTH_PX = 46

const CAPTION_BUTTONS: CaptionButtonId[] = ['minimize', 'maximize', 'close']

const CHROME_MINIMIZE_GLYPH = '\uE921'
const CHROME_MAXIMIZE_GLYPH = '\uE922'
const CHROME_RESTORE_GLYPH = '\uE923'
const CHROME_CLOSE_GLYPH = '\uE8BB'

function resolveCaptionGlyph(button: CaptionButtonId, maximized: boolean): string {
  if (button === 'minimize') {
    return CHROME_MINIMIZE_GLYPH
  }
  if (button === 'close') {
    return CHROME_CLOSE_GLYPH
  }
  return maximized ? CHROME_RESTORE_GLYPH : CHROME_MAXIMIZE_GLYPH
}

export function WindowsCaptionButtonsView({
  maximized,
  hoveredButton,
  pressedButton,
  labels,
  onRectsChange,
  onButtonClick,
}: WindowsCaptionButtonsViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const buttonsRef = useRef<Partial<Record<CaptionButtonId, HTMLDivElement | null>>>({})

  const reportRects = useCallback(() => {
    if (!containerRef.current) {
      return
    }
    const rects: CaptionButtonRect[] = []
    for (const button of CAPTION_BUTTONS) {
      const element = buttonsRef.current[button]
      if (!element) {
        continue
      }
      const rect = element.getBoundingClientRect()
      rects.push({
        button,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      })
    }
    onRectsChange(rects)
  }, [onRectsChange])

  useEffect(() => {
    reportRects()
    const observer = new ResizeObserver(reportRects)
    if (containerRef.current) {
      observer.observe(containerRef.current)
    }
    window.addEventListener('resize', reportRects)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', reportRects)
    }
  }, [reportRects])

  const renderGlyph = (button: CaptionButtonId) => (
    <span
      aria-hidden="true"
      className="block text-[10px] leading-none"
      style={{ fontFamily: GLYPH_FONT }}
    >
      {resolveCaptionGlyph(button, maximized)}
    </span>
  )

  return (
    <div ref={containerRef} className="flex h-full shrink-0 items-stretch">
      {CAPTION_BUTTONS.map((button) => {
        const isClose = button === 'close'
        const label = button === 'minimize'
          ? labels.minimize
          : button === 'maximize' && maximized
            ? labels.restore
            : button === 'maximize' ? labels.maximize : labels.close
        return (
          <div
            key={button}
            ref={(element) => {
              buttonsRef.current[button] = element
            }}
            role="button"
            tabIndex={-1}
            aria-label={label}
            title={label}
            onClick={() => onButtonClick(button)}
            style={{
              WebkitAppRegion: 'no-drag',
              width: `${BUTTON_WIDTH_PX}px`,
            } as React.CSSProperties}
            className={cn(
              'flex h-full cursor-default select-none items-center justify-center text-foreground',
              'transition-none',
              !isClose && [
                'hover:bg-foreground/[0.06] active:bg-foreground/[0.03]',
                hoveredButton === button && 'bg-foreground/[0.06]',
                pressedButton === button && 'bg-foreground/[0.03]',
              ],
              isClose && [
                'hover:bg-[#C42B1C] hover:text-white active:bg-[#B32719]',
                hoveredButton === button && 'bg-[#C42B1C] text-white',
                pressedButton === button && 'bg-[#B32719] text-white',
              ],
            )}
          >
            {renderGlyph(button)}
          </div>
        )
      })}
    </div>
  )
}
