import { domAnimation, LazyMotion } from 'motion/react'
import type { ReactNode } from 'react'
import { useEffect } from 'react'

import { TooltipProvider } from '../src/components/ui/tooltip'
import { I18nProvider } from '../src/i18n/client'

export function PreviewSurface({
  children,
  theme,
}: {
  children: ReactNode
  theme: 'light' | 'dark'
}) {
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.documentElement.style.colorScheme = theme
  }, [theme])

  return (
    <LazyMotion features={domAnimation}>
      <I18nProvider initialLocale="en-US">
        <TooltipProvider>
          <div className="min-h-screen bg-background text-foreground">{children}</div>
        </TooltipProvider>
      </I18nProvider>
    </LazyMotion>
  )
}
