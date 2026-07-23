import type { ReactNode } from 'react'
import { useEffect } from 'react'

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
    <I18nProvider initialLocale="en-US">
      <div className="min-h-screen bg-background text-foreground">{children}</div>
    </I18nProvider>
  )
}
