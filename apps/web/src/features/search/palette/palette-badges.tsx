import { useTranslation } from 'react-i18next'

import { cn } from '~/lib/cn'

import { PALETTE_MODES } from './modes'
import type { PaletteModeId } from './types'

interface PaletteFilterBadgesProps {
  activeMode: PaletteModeId
  counts: Partial<Record<PaletteModeId, number>>
  onSelect: (mode: PaletteModeId) => void
}

/**
 * Horizontal, scrollable strip of mode filter pills. The active pill lifts to
 * a subtle filled surface (`bg-muted text-foreground`) - a quiet, typographic
 * tab rather than a stark inversion. Clicking a pill rewrites the input
 * prefix via {@link setPaletteMode}, so the existing prefix-based model stays
 * the source of truth.
 */
export function PaletteFilterBadges({ activeMode, counts, onSelect }: PaletteFilterBadgesProps) {
  const { t } = useTranslation('search')

  return (
    <div className="no-scrollbar flex items-center gap-1 overflow-x-auto px-2.5 py-2">
      {PALETTE_MODES.map((mode) => {
        const active = mode.id === activeMode
        const count = counts[mode.id]
        const Icon = mode.icon

        return (
          <button
            key={mode.id}
            type="button"
            onClick={() => onSelect(mode.id)}
            aria-pressed={active}
            className={cn(
              'flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-medium whitespace-nowrap',
              active
                ? 'bg-foreground/[0.10] text-foreground'
                : 'text-muted-foreground/55 hover:bg-foreground/[0.04] hover:text-foreground',
            )}
          >
            <Icon className="size-3" />
            <span>{t(mode.badgeLabelKey)}</span>
            {count != null && count > 0 && (
              <span className={cn('tabular-nums', active ? 'text-muted-foreground/70' : 'text-muted-foreground/40')}>
                {count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
