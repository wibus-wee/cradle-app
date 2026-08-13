import type { ComponentType } from 'react'
import { lazy, Suspense } from 'react'

import { cn } from '~/lib/cn'

import { settingsSectionLoaders } from './settings-section-loaders'

const SECTION_MAP: Record<string, ComponentType> = Object.fromEntries(
  Object.entries(settingsSectionLoaders).map(([section, loader]) => [section, lazy(loader)]),
)

const FIXED_HEIGHT_SECTIONS = new Set(['import', 'providers', 'agents', 'runtimes', 'integrations', 'downloads'])

interface SettingsContentProps {
  section: string
}

export function SettingsContent({ section }: SettingsContentProps) {
  const activeSection = !import.meta.env.DEV && (section === 'chronicle' || section === 'externalIssues') ? 'appearance' : section
  const ActiveSection = SECTION_MAP[activeSection] ?? SECTION_MAP.appearance
  const fixedHeight = FIXED_HEIGHT_SECTIONS.has(activeSection)
  const fullBleed = activeSection === 'downloads'

  return (
    <div className="h-full min-h-0 w-full min-w-0 flex-1 overflow-hidden">
      <div
        className={cn(
          'box-border h-full w-full min-w-0',
          fullBleed ? 'overflow-hidden' : 'px-8 pt-10',
          fixedHeight ? 'overflow-hidden' : 'overflow-y-auto pb-10',
        )}
      >
        <Suspense fallback={<div className="h-full w-full animate-pulse rounded-lg bg-muted/30" />}>
          <ActiveSection />
        </Suspense>
      </div>
    </div>
  )
}
