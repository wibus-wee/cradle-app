import * as React from 'react'
import { useEffect, useState } from 'react'

interface BackBottomButtonProps {
  /** Whether content is being generated */
  generating: boolean
  /** Whether user has scrolled away from bottom */
  isAwayFromBottom: boolean
  /** Callback to scroll to bottom */
  onScrollToBottom: () => void
  /** Custom class name */
  className?: string
  /** Custom label */
  label?: string
}

/**
 * Floating button that appears when user scrolls away from bottom during generation.
 * Provides a way to quickly return to the latest content.
 */
export function BackBottomButton({
  generating,
  isAwayFromBottom,
  onScrollToBottom,
  className,
  label = '↓ Back to bottom',
}: BackBottomButtonProps) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // Show when user is away from bottom (either during generation or after)
    setVisible(isAwayFromBottom)
  }, [isAwayFromBottom])

  if (!visible) {
    return null
  }

  return (
    <button
      type="button"
      onClick={() => {
        onScrollToBottom()
        setVisible(false)
      }}
      className={className}
      style={className
? undefined
: {
        position: 'absolute',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '6px 16px',
        borderRadius: 20,
        border: '1px solid var(--border, rgba(255,255,255,0.1))',
        background: 'var(--back-bottom-bg, rgba(0,0,0,0.8))',
        color: 'var(--back-bottom-fg, #fff)',
        fontSize: 12,
        cursor: 'pointer',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        backdropFilter: 'blur(8px)',
        transition: 'opacity 200ms, transform 200ms',
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
      }}
      aria-label="Scroll to bottom"
    >
      {generating && (
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#3b82f6', animation: 'stream-cursor-pulse 1000ms infinite' }} />
      )}
      {label}
    </button>
  )
}

export type { BackBottomButtonProps }
