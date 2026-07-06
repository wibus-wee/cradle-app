import {
  ArrowRightLine as ArrowRight,
  Book2Line as BookOpen,
  BracesLine as Braces,
  FileCodeLine as FileJson,
  PluginLine as Plug,
  SafeShieldLine as ShieldCheck,
} from '@mingcute/react'
import type { Metadata } from 'next'
import Link from 'next/link'

import { PluginMarketplace } from '@/components/plugin-marketplace'
import { pluginMarketplaceEntries } from '@/lib/plugin-marketplace'

export const metadata: Metadata = {
  title: 'Plugin Marketplace',
  description: 'Browse Cradle plugins, runtime layers, trust notes, and install links.',
}

const marketplaceStats = [
  {
    label: 'Plugins',
    value: pluginMarketplaceEntries.length,
  },
  {
    label: 'Runtime layers',
    value: new Set(pluginMarketplaceEntries.flatMap(plugin => plugin.layers)).size,
  },
  {
    label: 'Install protocol',
    value: 'cradle://',
  },
] satisfies Array<{ label: string, value: number | string }>

export default function PluginMarketplacePage() {
  return (
    <main className="min-h-screen bg-fd-background text-fd-foreground">
      <header className="border-b border-fd-border bg-fd-card/80 backdrop-blur-sm">
        <div className="mx-auto flex min-h-16 w-full max-w-7xl items-center justify-between gap-4 px-5 sm:px-6 lg:px-8">
          <Link
            href="/"
            className="inline-flex min-h-10 items-center gap-2 rounded-md px-2 text-sm font-semibold text-fd-foreground no-underline transition-[background-color,transform] duration-150 hover:bg-fd-muted active:scale-[0.96]"
          >
            <span className="inline-flex size-8 items-center justify-center rounded-md bg-fd-primary text-fd-primary-foreground">
              <Plug className="size-4" aria-hidden="true" />
            </span>
            Cradle Marketplace
          </Link>
          <nav className="flex items-center gap-2">
            <Link
              href="/docs/developers/plugins/install-links"
              className="hidden min-h-10 items-center gap-2 rounded-md px-3 text-sm font-medium text-fd-muted-foreground no-underline transition-[background-color,color,transform] duration-150 hover:bg-fd-muted hover:text-fd-foreground active:scale-[0.96] sm:inline-flex"
            >
              <Braces className="size-4" aria-hidden="true" />
              Install links
            </Link>
            <Link
              href="/docs"
              className="inline-flex min-h-10 items-center gap-2 rounded-md px-3 text-sm font-medium text-fd-muted-foreground no-underline transition-[background-color,color,transform] duration-150 hover:bg-fd-muted hover:text-fd-foreground active:scale-[0.96]"
            >
              <BookOpen className="size-4" aria-hidden="true" />
              Docs
            </Link>
          </nav>
        </div>
      </header>

      <section className="border-b border-fd-border">
        <div className="mx-auto grid w-full max-w-7xl gap-8 px-5 py-12 sm:px-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:px-8 lg:py-16">
          <div className="min-w-0">
            <div className="mb-5 inline-flex min-h-8 items-center gap-2 rounded-md bg-fd-muted px-3 text-sm font-medium text-fd-muted-foreground">
              <ShieldCheck className="size-4 !text-emerald-600 dark:!text-emerald-300" aria-hidden="true" />
              First-party plugin directory
            </div>
            <h1 className="m-0 max-w-3xl text-4xl font-semibold leading-tight text-fd-foreground sm:text-5xl">
              Plugin Marketplace
            </h1>
            <p className="mt-5 max-w-3xl text-lg leading-8 text-fd-muted-foreground">
              Browse Cradle plugins in a standalone marketplace, inspect runtime layers and trust
              boundaries, then copy or open an install link handled by Cradle desktop through a
              guarded deep-link flow.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href="#marketplace"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-fd-primary px-4 text-sm font-medium text-fd-primary-foreground no-underline transition-[background-color,transform] duration-150 hover:bg-fd-primary/90 active:scale-[0.96]"
              >
                Browse plugins
                <ArrowRight className="size-4" aria-hidden="true" />
              </a>
              <Link
                href="/api/plugin-marketplace"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-fd-border bg-fd-card px-4 text-sm font-medium text-fd-foreground no-underline shadow-sm transition-[background-color,transform] duration-150 hover:bg-fd-muted active:scale-[0.96]"
              >
                <FileJson className="size-4" aria-hidden="true" />
                Registry JSON
              </Link>
            </div>
          </div>

          <aside className="grid gap-3 rounded-lg border border-fd-border bg-fd-card p-4 shadow-sm">
            {marketplaceStats.map(stat => (
              <div
                key={stat.label}
                className="flex min-h-20 items-center justify-between gap-4 rounded-md bg-fd-muted px-4"
              >
                <span className="text-sm font-medium text-fd-muted-foreground">{stat.label}</span>
                <span className="text-2xl font-semibold tabular-nums text-fd-foreground">
                  {stat.value}
                </span>
              </div>
            ))}
          </aside>
        </div>
      </section>

      <section id="marketplace" className="mx-auto w-full max-w-7xl px-5 py-8 sm:px-6 lg:px-8">
        <PluginMarketplace className="my-0" />
      </section>
    </main>
  )
}
