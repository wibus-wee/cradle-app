import { m } from 'motion/react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { useResolvedThemeMode } from '~/store/theme'

import { useOnboardingStore } from './onboarding-store'

// Silky springs — low stiffness for slow, flowing motion; tuned damping for
// minimal bounce. Heavy enough to feel substantial, soft enough to feel smooth.
const SPRING = { type: 'spring', stiffness: 200, damping: 28 } as const
const SPRING_SOFT = { type: 'spring', stiffness: 150, damping: 24 } as const
// Smooth-in-out for the shimmer sweep — Material standard ease.
const SHIMMER_EASE = [0.4, 0, 0.2, 1] as const

const CRADLE_ICON_URL = './icon.png'

// AE-style narrative timeline (overlapping for continuous flow):
//   0.2s  ─ icon materialises large in centre (slow spring settle ~1.3s)
//   1.0s  ─ diagonal shimmer begins sweeping (1.5s silky pass)
//   2.2s  ─ name reveals as shimmer exits
//   2.8s  ─ slogan settles in below
//   3.5s  ─ continue hint
export function OnboardingPage() {
  const { t } = useTranslation('onboarding')
  const complete = useOnboardingStore(s => s.complete)
  const mode = useResolvedThemeMode()
  const isDark = mode === 'dark'

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'Escape') { complete() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [complete])

  const shimmerColor = isDark ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.85)'

  return (
    <div
      className="fixed inset-0 z-9999 flex cursor-pointer flex-col items-center justify-center bg-background px-6 text-foreground"
      onClick={complete}
    >
      <div className="flex flex-col items-center">
        {/* Icon — establishes centre stage, then lifts as name reveals */}
        <m.div
          className="relative mb-9"
          initial={{ opacity: 0, scale: 1.7, y: 50 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ ...SPRING_SOFT, delay: 0.2 }}
        >
          <div className="relative size-24 overflow-hidden rounded-[24px] bg-muted/40 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.05)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]">
            <img src={CRADLE_ICON_URL} alt="" className="size-full object-cover" draggable={false} />
            {/* Shimmer — single slow diagonal light pass */}
            <m.div
              className="pointer-events-none absolute inset-0"
              style={{
                background: `linear-gradient(110deg, transparent 30%, ${shimmerColor} 50%, transparent 70%)`,
              }}
              initial={{ x: '-150%' }}
              animate={{ x: '150%' }}
              transition={{ delay: 1.0, duration: 1.5, ease: SHIMMER_EASE }}
            />
          </div>
        </m.div>

        {/* Name — reveals as shimmer exits */}
        <m.h1
          className="text-center text-[clamp(3rem,8vw,5rem)] font-semibold leading-none tracking-[-0.04em]"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...SPRING, delay: 2.2 }}
        >
          {t('brand.name')}
        </m.h1>

        {/* Slogan — settles in below name */}
        <m.p
          className="mt-4 text-center text-[clamp(1rem,1.6vw,1.125rem)] text-muted-foreground"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...SPRING, delay: 2.8 }}
        >
          {t('brand.tagline')}
        </m.p>
      </div>

      {/* Continue hint */}
      <m.div
        className="absolute bottom-8 flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground/50"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, ease: SHIMMER_EASE, delay: 3.5 }}
      >
        <kbd className="rounded border border-border bg-muted/40 px-1.5 py-0.5">↵</kbd>
        <span>{t('nav.continueHint')}</span>
      </m.div>
    </div>
  )
}
