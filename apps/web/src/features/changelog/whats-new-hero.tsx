// Seeded shader-gradient hero for the What's New dialog.
// White overlay content sits on a dark, slow-moving mesh gradient whose
// palette and distortion are derived from the release version (see whats-new-look).
import { SparklesLine as SparklesIcon } from '@mingcute/react'
import { MeshGradient } from '@paper-design/shaders-react'
import { useReducedMotion } from 'motion/react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '~/lib/cn'

import { releaseLookForVersion } from './whats-new-look'

interface WhatsNewHeroProps {
  version: string
  /** Title + meta nodes rendered over the gradient (DialogTitle etc.). */
  children: React.ReactNode
  className?: string
}

export function WhatsNewHero({ version, children, className }: WhatsNewHeroProps) {
  const { t } = useTranslation('chrome')
  const look = useMemo(() => releaseLookForVersion(version), [version])
  const reduceMotion = useReducedMotion()

  return (
    <div className={cn('relative h-64 overflow-hidden rounded-t-xl select-none', className)}>
      <MeshGradient
        colors={look.colors}
        distortion={look.distortion}
        swirl={look.swirl}
        scale={look.scale}
        rotation={look.rotation}
        offsetX={look.offsetX}
        offsetY={look.offsetY}
        grainOverlay={0.15}
        speed={reduceMotion ? 0 : 0.35}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        aria-hidden="true"
      />
      {/* Scrim for text legibility over the artwork */}
      <div
        className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent"
        aria-hidden="true"
      />
      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1 p-4">
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-white/70">
          <SparklesIcon className="size-3" aria-hidden="true" />
          {t('whatsNew.eyebrow')}
        </span>
        {children}
      </div>
    </div>
  )
}
