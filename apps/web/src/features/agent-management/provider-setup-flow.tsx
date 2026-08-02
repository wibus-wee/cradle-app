import {
  ArrowLeftLine as ArrowLeftIcon,
  RightSmallLine as ChevronRightIcon,
  SearchLine as SearchIcon,
} from '@mingcute/react'
import { AnimatePresence, m } from 'motion/react'
import { useState } from 'react'

import { ProviderIconTile } from '~/components/common/provider-icons'
import { Input } from '~/components/ui/input'
import { cn } from '~/lib/cn'

import { ProviderSetupForm } from './provider-setup-form'
import type { ProviderPreset } from './provider-templates'
import { useMergedProviderPresets } from './use-provider-presets'

/** Presets promoted to the large-card featured row. */
const FEATURED_PRESET_IDS = ['anthropic', 'openai', 'universal']

/** Parallel blur-fade for gallery ↔ form — overlapping, not wait-serialized. */
const stepTransition = { duration: 0.14, ease: [0.22, 1, 0.36, 1] } as const
const stepEnter = { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' } as const
const stepExit = { opacity: 0, y: 4, scale: 0.985, filter: 'blur(5px)' } as const

/**
 * Two-step "add provider" flow: a searchable preset gallery crossfades into the
 * credential form for the chosen preset. Dialog-agnostic — hosts decide the
 * height (the settings dialog pins it, onboarding lets it flow) while the
 * internal regions scroll or grow accordingly.
 */
export function ProviderSetupFlow({
  presetId,
  onSelectPreset,
  onComplete,
  onCancel,
  showGalleryHeader = true,
  className,
}: {
  presetId: string | null
  onSelectPreset: (presetId: string) => void
  onComplete: (newProfileId?: string) => void
  /** Optional escape hatch rendered in the gallery footer (e.g. "Skip" in onboarding). */
  onCancel?: () => void
  /** Gallery renders its own title/search header unless the host provides one. */
  showGalleryHeader?: boolean
  className?: string
}) {
  const { presets } = useMergedProviderPresets()
  const preset = presets.find(p => p.id === presetId) ?? null

  return (
    <div className={cn('grid min-h-0 flex-1 grid-cols-1 grid-rows-1 overflow-hidden', className)}>
      <AnimatePresence initial={false}>
        {preset
          ? (
              <m.div
                key={`form-${preset.id}`}
                initial={{ opacity: 0, y: 6, scale: 0.985, filter: 'blur(5px)' }}
                animate={stepEnter}
                exit={stepExit}
                transition={stepTransition}
                className="col-start-1 row-start-1 flex min-h-0 flex-col"
              >
                {/* Step header */}
                <div className="flex shrink-0 items-center gap-3 border-b border-border/60 px-5 py-4">
                  <button
                    type="button"
                    onClick={() => onSelectPreset('')}
                    className="-ml-1 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
                    aria-label="Back to templates"
                  >
                    <ArrowLeftIcon className="size-3.5" />
                  </button>
                  <ProviderIconTile
                    iconSlug={preset.iconSlug ?? preset.name}
                    presetId={preset.id}
                    size="md"
                  />
                  <div className="min-w-0 flex-1">
                    <h4 className="font-heading text-[14px] font-medium text-foreground">{preset.name}</h4>
                    <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">{preset.tagline}</p>
                  </div>
                </div>
                <ProviderSetupForm key={preset.id} preset={preset} onComplete={onComplete} />
              </m.div>
            )
          : (
              <m.div
                key="gallery"
                initial={{ opacity: 0, y: 6, scale: 0.985, filter: 'blur(5px)' }}
                animate={stepEnter}
                exit={stepExit}
                transition={stepTransition}
                className="col-start-1 row-start-1 flex min-h-0 flex-col"
              >
                <PresetGallery
                  presets={presets}
                  onSelect={onSelectPreset}
                  onCancel={onCancel}
                  showHeader={showGalleryHeader}
                />
              </m.div>
            )}
      </AnimatePresence>
    </div>
  )
}

function PresetGallery({
  presets,
  onSelect,
  onCancel,
  showHeader,
}: {
  presets: ProviderPreset[]
  onSelect: (presetId: string) => void
  onCancel?: () => void
  showHeader: boolean
}) {
  const [query, setQuery] = useState('')
  const trimmedQuery = query.trim().toLowerCase()
  const visiblePresets = trimmedQuery
    ? presets.filter(p =>
      p.name.toLowerCase().includes(trimmedQuery)
      || p.id.includes(trimmedQuery)
      || p.tagline.toLowerCase().includes(trimmedQuery))
    : presets
  const featuredPresets = trimmedQuery
    ? []
    : FEATURED_PRESET_IDS
      .map(id => visiblePresets.find(p => p.id === id))
      .filter((p): p is ProviderPreset => !!p)
  const catalogPresets = trimmedQuery
    ? visiblePresets
    : visiblePresets.filter(p => !FEATURED_PRESET_IDS.includes(p.id))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={cn('flex shrink-0 flex-col gap-3 px-5', showHeader ? 'pb-4 pt-5' : 'pb-3')}>
        {showHeader && (
          <div className="flex flex-col gap-1">
            <h3 className="font-heading text-[15px] font-medium text-foreground">Add provider</h3>
            <p className="text-[12px] text-muted-foreground">
              Pick a template — credentials and endpoints come next.
            </p>
          </div>
        )}
        <div className="relative min-w-0">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 !text-muted-foreground/60" />
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search providers..."
            className="h-8 pl-8 text-[12.5px]"
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 pb-5">
        {featuredPresets.length > 0 && (
          <section className="flex flex-col gap-2">
            <h4 className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground/60">
              Featured
            </h4>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {featuredPresets.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onSelect(p.id)}
                  data-testid={`provider-preset-${p.id}`}
                  className={cn(
                    'group/featured relative flex flex-col items-start gap-3 rounded-xl bg-card p-4 text-left',
                    'ring-1 ring-foreground/[0.07] transition-[box-shadow,ring-color,transform] duration-150',
                    'hover:-translate-y-0.5 hover:ring-foreground/15 hover:shadow-md hover:shadow-foreground/[0.05]',
                    'active:scale-[0.98]',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                  )}
                >
                  <ProviderIconTile iconSlug={p.iconSlug ?? p.name} presetId={p.id} size="lg" />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-[13px] font-medium text-foreground">{p.name}</span>
                    <span className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                      {p.tagline}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="flex flex-col gap-2">
          <h4 className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground/60">
            {trimmedQuery ? 'Results' : 'All providers'}
          </h4>
          {catalogPresets.length > 0
            ? (
                <div className="overflow-hidden rounded-xl ring-1 ring-foreground/[0.07]">
                  <div className="divide-y divide-border/50">
                    {catalogPresets.map(p => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => onSelect(p.id)}
                        data-testid={`provider-preset-${p.id}`}
                        className={cn(
                          'group/preset flex w-full items-center gap-3 bg-card px-3 py-2.5 text-left',
                          'transition-colors duration-150 hover:bg-foreground/[0.035]',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset',
                        )}
                      >
                        <ProviderIconTile iconSlug={p.iconSlug ?? p.name} presetId={p.id} size="sm" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[12.5px] font-medium text-foreground">{p.name}</div>
                          <div className="truncate text-[11px] text-muted-foreground">{p.tagline}</div>
                        </div>
                        <ChevronRightIcon className="size-3.5 shrink-0 !text-muted-foreground/30 transition-[transform,color] duration-150 group-hover/preset:translate-x-0.5 group-hover/preset:!text-muted-foreground" />
                      </button>
                    ))}
                  </div>
                </div>
              )
            : (
                <p className="py-6 text-center text-[11.5px] text-muted-foreground/70">
                  No providers match your search.
                </p>
              )}
        </section>

        {onCancel && (
          <div className="flex justify-center pb-1">
            <button
              type="button"
              onClick={onCancel}
              className="text-[11.5px] text-muted-foreground/70 transition-colors hover:text-foreground"
            >
              Skip for now
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
