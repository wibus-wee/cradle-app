// FILE: browser-annotation-adjustment-panel.tsx
// Purpose: Browser-owned visual inspector for selected page elements and draft style adjustments.
// Layer: Browser feature UI
// Depends on: BrowserPanel Zustand store, browser-annotation-design-fields

import {
  AnticlockwiseLine as RotateCcwIcon,
  CodeLine as Code2Icon,
  Cursor2Line as MousePointer2Icon,
  DownSmallLine as ChevronDownIcon,
  PlusLine as PlusIcon,
  SelectorHorizontalLine as SlidersHorizontalIcon,
  SubtractLine as MinusIcon,
} from '@mingcute/react'
import type { ReactNode } from 'react'
import { useState } from 'react'

import { Button } from '~/components/ui/button'
import { ColorPalette } from '~/components/ui/color-palette'
import { Input } from '~/components/ui/input'
import { cn } from '~/lib/cn'
import type {
  BrowserAnnotationDesignStyleKey,
  BrowserAnnotationElement,
} from '~/store/browser-panel'
import { useBrowserPanelStore } from '~/store/browser-panel'

import type { BrowserAnnotationDesignFieldDefinition, BrowserAnnotationInspectorGroup, BrowserAnnotationSegmentOption } from './browser-annotation-design-fields'
import {
  BROWSER_ANNOTATION_DESIGN_FIELDS,
  BROWSER_ANNOTATION_INSPECTOR_GROUPS,
  BROWSER_ANNOTATION_POSITION_OPTIONS,
  browserAnnotationCssRows,
  browserAnnotationElementStyleValue,
  browserAnnotationSelectorSegments,
  countBrowserAnnotationDraftChanges,
  formatBrowserAnnotationScrubValue,
  normalizedBrowserAnnotationSegmentValue,
  parseBrowserAnnotationScrubValue,
  readableBrowserAnnotationStyleValue,
} from './browser-annotation-design-fields'

export const BROWSER_ANNOTATION_ADJUSTMENT_APPLY_EVENT = 'browser:annotation-adjustment-apply'

export interface BrowserAnnotationAdjustmentApplyDetail {
  ownerId: string
  tabId: string
}

interface SegmentControlProps {
  value: string
  options: readonly BrowserAnnotationSegmentOption[]
  columns?: number
  onChange: (value: string) => void
}

function SegmentControl({ value, options, columns, onChange }: SegmentControlProps) {
  return (
    <div
      className={cn(
        'grid h-8 gap-0.5 rounded-lg bg-foreground/5 p-0.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] dark:bg-white/6',
        columns === 5 ? 'grid-cols-5' : 'auto-cols-fr grid-flow-col',
      )}
    >
      {options.map((option) => {
        const selected = value === option.value
        return (
          <Button
            key={option.value}
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              'h-7 min-w-0 rounded-md px-1.5 text-[10px] font-medium text-muted-foreground active:scale-[0.96]',
              selected && 'bg-primary text-primary-foreground shadow-[0_1px_3px_rgba(0,0,0,0.16),inset_0_0_0_1px_rgba(255,255,255,0.10)]',
              option.italic && 'italic',
              option.underline && 'underline underline-offset-2',
              option.strikethrough && 'line-through',
            )}
            onClick={() => onChange(option.value)}
            aria-label={option.label}
            title={option.label}
          >
            {option.text}
          </Button>
        )
      })}
    </div>
  )
}

interface DesignInputProps {
  field: BrowserAnnotationDesignFieldDefinition
  value: string
  originalValue: string
  onChange: (value: string) => void
  onReset: () => void
}

function DesignInput({ field, value, originalValue, onChange, onReset }: DesignInputProps) {
  const changed = value.trim().length > 0
  const effectiveValue = value || originalValue
  const segmentValue = normalizedBrowserAnnotationSegmentValue(field.key, effectiveValue)
  const scrubValue = parseBrowserAnnotationScrubValue(effectiveValue)
  const readableOriginal = readableBrowserAnnotationStyleValue(originalValue)

  if (field.control === 'segment' && field.segmentOptions) {
    return (
      <InspectorRow label={field.label} changed={changed} onReset={onReset}>
        <SegmentControl
          value={segmentValue}
          options={field.segmentOptions}
          columns={field.segmentColumns}
          onChange={onChange}
        />
      </InspectorRow>
    )
  }

  const handleScrub = (delta: number) => {
    if (!scrubValue) {
      return
    }
    onChange(formatBrowserAnnotationScrubValue({
      number: scrubValue.number + delta,
      unit: scrubValue.unit,
    }))
  }

  return (
    <InspectorRow label={field.label} changed={changed} onReset={onReset}>
      <span className="flex min-w-0 items-center gap-1">
        {field.control === 'color' && (
          <ColorPalette
            value={effectiveValue}
            label={field.label}
            onChange={onChange}
          />
        )}
        {scrubValue && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-7 shrink-0 rounded-full text-muted-foreground hover:bg-foreground/7 hover:text-foreground active:scale-[0.96]"
            onClick={() => handleScrub(-1)}
            aria-label={`Decrease ${field.label}`}
          >
            <MinusIcon className="size-3.5" />
          </Button>
        )}
        <Input
          type="text"
          value={value}
          aria-label={field.label}
          placeholder={readableOriginal}
          className={cn(
            'h-7 min-w-0 flex-1 rounded-lg border-0 bg-background/80 px-2 font-mono text-[11px] ring-1 transition-[background-color,box-shadow,color] duration-150 placeholder:text-muted-foreground/45 focus:bg-background focus-visible:ring-primary/55 md:text-[11px] dark:bg-white/5 dark:focus:bg-white/8',
            changed ? 'ring-primary/55' : 'ring-border/60 dark:ring-white/10',
          )}
          onChange={event => onChange(event.target.value)}
        />
        {scrubValue && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-7 shrink-0 rounded-full text-muted-foreground hover:bg-foreground/7 hover:text-foreground active:scale-[0.96]"
            onClick={() => handleScrub(1)}
            aria-label={`Increase ${field.label}`}
          >
            <PlusIcon className="size-3.5" />
          </Button>
        )}
      </span>
    </InspectorRow>
  )
}

interface InspectorRowProps {
  label: string
  changed?: boolean
  onReset?: () => void
  children: ReactNode
}

function InspectorRow({ label, changed = false, onReset, children }: InspectorRowProps) {
  return (
    <label className="grid grid-cols-[72px_minmax(0,1fr)_28px] items-center gap-2 text-xs">
      <span className={cn('text-muted-foreground transition-colors duration-150', changed && 'text-primary')}>{label}</span>
      <span className="min-w-0">{children}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="size-7 shrink-0 rounded-full text-muted-foreground hover:bg-foreground/7 hover:text-foreground active:scale-[0.96] disabled:opacity-25 disabled:active:scale-100"
        disabled={!changed}
        onClick={onReset}
        aria-label={`Reset ${label}`}
      >
        <RotateCcwIcon className="size-3.5" />
      </Button>
    </label>
  )
}

interface InspectorSectionProps {
  title: string
  children: ReactNode
}

function InspectorSection({ title, children }: InspectorSectionProps) {
  return (
    <section className="border-b border-border/55 px-3 py-3 dark:border-white/6">
      <div className="mb-2 flex items-center gap-1.5">
        <ChevronDownIcon className="size-3.5 !text-muted-foreground/70" aria-hidden="true" />
        <h3 className="text-xs font-semibold text-foreground">{title}</h3>
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

interface ReadOnlyMetricProps {
  label: string
  value: string
}

function ReadOnlyMetric({ label, value }: ReadOnlyMetricProps) {
  return (
    <div className="min-w-0 rounded-lg bg-foreground/5 px-2 py-1.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] dark:bg-white/6">
      <div className="text-[10px] font-medium uppercase tracking-normal text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 truncate font-mono text-[11px] text-foreground tabular-nums">
        {value}
      </div>
    </div>
  )
}

function EmptyInspector() {
  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <div className="max-w-56 animate-[browser-annotation-popup-enter_200ms_cubic-bezier(0.34,1.56,0.64,1)_both] text-center motion-reduce:animate-none">
        <span className="mx-auto mb-2 flex size-9 items-center justify-center rounded-full bg-primary/12 text-primary shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
          <MousePointer2Icon className="size-4" />
        </span>
        <p className="text-xs text-muted-foreground">
          Select an element in browser comment mode to inspect and adjust it.
        </p>
      </div>
    </div>
  )
}

function PositionSection({
  element,
  positionValue,
  zIndexValue,
  onPositionChange,
  onZIndexChange,
  onPositionReset,
  onZIndexReset,
}: {
  element: BrowserAnnotationElement
  positionValue: string
  zIndexValue: string
  onPositionChange: (value: string) => void
  onZIndexChange: (value: string) => void
  onPositionReset: () => void
  onZIndexReset: () => void
}) {
  const effectivePosition = positionValue || element.styles.position || 'static'
  const effectiveZIndex = zIndexValue || element.styles.zIndex || 'auto'
  const positionChanged = positionValue.trim().length > 0
  const zIndexChanged = zIndexValue.trim().length > 0

  return (
    <InspectorSection title="Position">
      <div className="grid grid-cols-3 gap-2">
        <ReadOnlyMetric label="X" value={`${Math.round(element.rect.x)}`} />
        <ReadOnlyMetric label="Y" value={`${Math.round(element.rect.y)}`} />
        <ReadOnlyMetric
          label="W × H"
          value={`${Math.round(element.rect.width)} × ${Math.round(element.rect.height)}`}
        />
      </div>
      <InspectorRow label="Mode" changed={positionChanged} onReset={onPositionReset}>
        <SegmentControl
          value={effectivePosition}
          options={BROWSER_ANNOTATION_POSITION_OPTIONS}
          onChange={onPositionChange}
        />
      </InspectorRow>
      <InspectorRow label="Z" changed={zIndexChanged} onReset={onZIndexReset}>
        <Input
          type="text"
          value={zIndexValue}
          aria-label="Z-index"
          placeholder={readableBrowserAnnotationStyleValue(effectiveZIndex)}
          className={cn(
            'h-7 min-w-0 flex-1 rounded-lg border-0 bg-background/80 px-2 font-mono text-[11px] ring-1 transition-[background-color,box-shadow,color] duration-150 placeholder:text-muted-foreground/45 focus:bg-background focus-visible:ring-primary/55 md:text-[11px] dark:bg-white/5 dark:focus:bg-white/8',
            zIndexChanged ? 'ring-primary/55' : 'ring-border/60 dark:ring-white/10',
          )}
          onChange={event => onZIndexChange(event.target.value)}
        />
      </InspectorRow>
    </InspectorSection>
  )
}

type InspectorTab = 'design' | 'css'

export function BrowserAnnotationAdjustmentPanel() {
  const adjustmentSession = useBrowserPanelStore(state => state.annotationAdjustmentSession)
  const updateDesignChanges = useBrowserPanelStore(
    state => state.updateAnnotationAdjustmentDesignChanges,
  )
  const [activeTab, setActiveTab] = useState<InspectorTab>('design')

  const selectedElement = adjustmentSession?.selectedElement
  const designChanges = adjustmentSession?.designChanges ?? {}
  const changeCount = countBrowserAnnotationDraftChanges(designChanges)

  const fieldsByGroup = (() => {
    const groups: Record<BrowserAnnotationInspectorGroup, BrowserAnnotationDesignFieldDefinition[]> = {
      Layout: [],
      Dimensions: [],
      Spacing: [],
      Typography: [],
      Fill: [],
      Stroke: [],
      Effects: [],
    }
    for (const field of BROWSER_ANNOTATION_DESIGN_FIELDS) {
      groups[field.group].push(field)
    }
    return groups
  })()

  const handleFieldChange = (key: BrowserAnnotationDesignStyleKey, value: string) => {
    updateDesignChanges({ [key]: value })
  }

  const handleFieldReset = (key: BrowserAnnotationDesignStyleKey) => {
    updateDesignChanges({ [key]: '' })
  }

  if (!adjustmentSession || !selectedElement) {
    return <EmptyInspector />
  }

  const segments = browserAnnotationSelectorSegments(selectedElement.selector)
  const rows = browserAnnotationCssRows(selectedElement, designChanges)
  const handleApply = () => {
    window.dispatchEvent(new CustomEvent<BrowserAnnotationAdjustmentApplyDetail>(
      BROWSER_ANNOTATION_ADJUSTMENT_APPLY_EVENT,
      {
        detail: {
          ownerId: adjustmentSession.ownerId,
          tabId: adjustmentSession.tabId,
        },
      },
    ))
  }

  return (
    <div
      className="flex flex-1 flex-col overflow-hidden bg-popover/95 text-popover-foreground shadow-[0_4px_24px_rgba(0,0,0,0.18),0_0_0_1px_rgba(0,0,0,0.06)] dark:bg-[#1a1a1a] dark:shadow-[0_4px_24px_rgba(0,0,0,0.34),0_0_0_1px_rgba(255,255,255,0.08)]"
      data-testid="browser-annotation-adjustment-panel"
    >
      <div className="border-b border-border/60 px-3 py-2 dark:border-white/6">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold text-foreground">Layers</h2>
          <span className="rounded-full bg-foreground/6 px-1.5 py-0.5 text-[10px] text-muted-foreground shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] tabular-nums dark:bg-white/6">
            {segments.length || 1}
          </span>
        </div>
        <div className="max-h-36 overflow-y-auto rounded-xl bg-background/75 py-1 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)] dark:bg-white/5 dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
          {(segments.length > 0 ? segments : [selectedElement.tagName.toLowerCase()]).map((segment, index, list) => {
            const selected = index === list.length - 1
            const key = list.slice(0, index + 1).join(' > ')
            return (
              <div
                key={key}
                className={cn(
                  'flex min-w-0 items-center gap-1.5 px-2 py-1 text-[11px] transition-[background-color,color] duration-150',
                  selected ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
                )}
                style={{ paddingLeft: `${8 + index * 10}px` }}
              >
                <Code2Icon className="size-3 shrink-0" aria-hidden="true" />
                <span className="min-w-0 truncate font-mono">{segment}</span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="flex h-10 shrink-0 items-center border-b border-border/60 px-3 dark:border-white/6">
        <div className="grid h-8 grid-cols-2 rounded-full bg-foreground/5 p-0.5 dark:bg-white/6">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              'h-7 gap-1.5 rounded-full px-2.5 text-xs active:scale-[0.96]',
              activeTab === 'design'
                ? 'bg-background text-foreground shadow-[0_1px_3px_rgba(0,0,0,0.16),inset_0_0_0_1px_rgba(255,255,255,0.08)] dark:bg-white/10'
                : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
            )}
            onClick={() => setActiveTab('design')}
          >
            <SlidersHorizontalIcon className="size-3.5" />
            Design
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              'h-7 gap-1.5 rounded-full px-2.5 text-xs active:scale-[0.96]',
              activeTab === 'css'
                ? 'bg-background text-foreground shadow-[0_1px_3px_rgba(0,0,0,0.16),inset_0_0_0_1px_rgba(255,255,255,0.08)] dark:bg-white/10'
                : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
            )}
            onClick={() => setActiveTab('css')}
          >
            <Code2Icon className="size-3.5" />
            CSS
          </Button>
        </div>
      </div>

      {activeTab === 'design' && (
        <div className="flex-1 overflow-y-auto animate-[browser-annotation-popup-enter_180ms_cubic-bezier(0.22,1,0.36,1)_both] motion-reduce:animate-none">
          <PositionSection
            element={selectedElement}
            positionValue={designChanges.position ?? ''}
            zIndexValue={designChanges.zIndex ?? ''}
            onPositionChange={value => handleFieldChange('position', value)}
            onZIndexChange={value => handleFieldChange('zIndex', value)}
            onPositionReset={() => handleFieldReset('position')}
            onZIndexReset={() => handleFieldReset('zIndex')}
          />

          {BROWSER_ANNOTATION_INSPECTOR_GROUPS.map((group) => {
            // Always show Layout / Dimensions / Spacing / Typography / Fill so
            // the inspector feels complete even when the page hasn't computed
            // every property yet. Stroke / Effects stay gated on a signal.
            const fields = fieldsByGroup[group]
            const alwaysShow = group === 'Layout'
              || group === 'Dimensions'
              || group === 'Spacing'
              || group === 'Typography'
              || group === 'Fill'
            const visibleFields = alwaysShow
              ? fields
              : fields.filter(field => Boolean(browserAnnotationElementStyleValue(selectedElement, field.key)))
            if (visibleFields.length === 0) {
              return null
            }

            return (
              <InspectorSection key={group} title={group}>
                {visibleFields.map((field) => {
                  const originalValue = browserAnnotationElementStyleValue(selectedElement, field.key)
                  const currentValue = designChanges[field.key] ?? ''
                  return (
                    <DesignInput
                      key={field.key}
                      field={field}
                      value={currentValue}
                      originalValue={originalValue}
                      onChange={value => handleFieldChange(field.key, value)}
                      onReset={() => handleFieldReset(field.key)}
                    />
                  )
                })}
              </InspectorSection>
            )
          })}
        </div>
      )}

      {activeTab === 'css' && (
        <div className="flex-1 overflow-y-auto p-3 animate-[browser-annotation-popup-enter_180ms_cubic-bezier(0.22,1,0.36,1)_both] motion-reduce:animate-none">
          <pre className="min-h-full overflow-x-auto rounded-xl bg-background/75 p-3 text-[11px] leading-5 text-muted-foreground shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)] dark:bg-white/5 dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
            <code>
              {`${selectedElement.selector} {\n${rows
                .map(row => `  ${row.property}: ${row.value};${row.changed ? ' /* draft */' : ''}`)
                .join('\n')}\n}`}
            </code>
          </pre>
        </div>
      )}

      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border/60 px-3 py-2 dark:border-white/6">
        <div className="min-w-0">
          <div className="truncate text-[11px] font-medium text-foreground">
            {selectedElement.tagName.toLowerCase()}
            {selectedElement.label ? ` · ${selectedElement.label}` : ''}
          </div>
          <div className="text-[10px] text-muted-foreground tabular-nums">
            {changeCount === 0 ? 'No draft changes' : `${changeCount} draft ${changeCount === 1 ? 'change' : 'changes'}`}
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          className="gap-1.5 rounded-full transition-[background-color,color,opacity,transform] active:scale-[0.96]"
          disabled={changeCount === 0}
          onClick={handleApply}
        >
          Apply
        </Button>
      </div>
    </div>
  )
}
