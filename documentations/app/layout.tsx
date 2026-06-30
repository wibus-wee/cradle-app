import './global.css'

import { RootProvider } from 'fumadocs-ui/provider/next'
import { GeistMono } from 'geist/font/mono'
import { GeistSans } from 'geist/font/sans'
import type { Metadata } from 'next'

import { appName } from '@/lib/shared'

export const metadata: Metadata = {
  title: {
    default: appName,
    template: `%s | ${appName}`,
  },
  description: 'Cradle product and developer documentation.',
}

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="zh-CN"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <body
        className="flex min-h-screen flex-col font-sans"
        style={{ fontFamily: 'var(--font-geist-sans), system-ui, sans-serif' }}
      >
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  )
}
