// FILE: browser-annotation-adjustment-panel.tsx
// Purpose: Browser-owned visual inspector for selected page elements and draft style adjustments.
// Layer: Browser feature UI
// Depends on: BrowserPanel Zustand store

import {
  AlignCenterLine as AlignCenterIcon,
  DistributeSpacingHorizontalLine as AlignHorizontalSpaceAroundIcon,
  DistributeSpacingHorizontalLine as AlignHorizontalSpaceBetweenIcon,
  AlignJustifyLine as AlignJustifyIcon,
  AlignLeftLine as AlignLeftIcon,
  AlignRightLine as AlignRightIcon,
  BoxLine as BoxIcon,
  DownSmallLine as ChevronDownIcon,
  CodeLine as Code2Icon,
  Columns2Line as Columns2Icon,
  SubtractLine as MinusIcon,
  Cursor2Line as MousePointer2Icon,
  PlusLine as PlusIcon,
  AnticlockwiseLine as RotateCcwIcon,
  Rows2Line as Rows2Icon,
  SelectorHorizontalLine as SlidersHorizontalIcon
} from '@mingcute/react'
import type { ReactNode } from 'react'
import { useState } from 'react'

import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { cn } from '~/lib/cn'
import type { BrowserAnnotationDesignChange, BrowserAnnotationElement } from '~/store/browser-panel'
import { useBrowserPanelStore } from '~/store/browser-panel'

import { BrowserColorPalette } from './browser-color-palette'

type DesignKey = Exclude<keyof BrowserAnnotationDesignChange, 'comment'>
type InspectorTab = 'design' | 'css'
type InspectorGroup = 'Position' | 'Layout' | 'Dimensions' | 'Spacing' | 'Appearance'

export const BROWSER_ANNOTATION_ADJUSTMENT_APPLY_EVENT = 'browser:annotation-adjustment-apply'

export interface BrowserAnnotationAdjustmentApplyDetail {
  ownerId: string
  tabId: string
}

interface BrowserAnnotationDesignField {
  key: DesignKey
  label: string
  cssProperty: string
  group: InspectorGroup
  swatch?: boolean
}

const DESIGN_FIELDS: BrowserAnnotationDesignField[] = [
  { key: 'display', label: 'Flow', cssProperty: 'display', group: 'Layout' },
  { key: 'flexDirection', label: 'Direction', cssProperty: 'flex-direction', group: 'Layout' },
  { key: 'alignItems', label: 'Align', cssProperty: 'align-items', group: 'Layout' },
  { key: 'justifyContent', label: 'Justify', cssProperty: 'justify-content', group: 'Layout' },
  { key: 'rowGap', label: 'Row gap', cssProperty: 'row-gap', group: 'Layout' },
  { key: 'columnGap', label: 'Col gap', cssProperty: 'column-gap', group: 'Layout' },
  { key: 'width', label: 'W', cssProperty: 'width', group: 'Dimensions' },
  { key: 'height', label: 'H', cssProperty: 'height', group: 'Dimensions' },
  { key: 'paddingTop', label: 'Pad top', cssProperty: 'padding-top', group: 'Spacing' },
  { key: 'paddingRight', label: 'Pad right', cssProperty: 'padding-right', group: 'Spacing' },
  { key: 'paddingBottom', label: 'Pad bottom', cssProperty: 'padding-bottom', group: 'Spacing' },
  { key: 'paddingLeft', label: 'Pad left', cssProperty: 'padding-left', group: 'Spacing' },
  { key: 'marginTop', label: 'Mar top', cssProperty: 'margin-top', group: 'Spacing' },
  { key: 'marginRight', label: 'Mar right', cssProperty: 'margin-right', group: 'Spacing' },
  { key: 'marginBottom', label: 'Mar bottom', cssProperty: 'margin-bottom', group: 'Spacing' },
  { key: 'marginLeft', label: 'Mar left', cssProperty: 'margin-left', group: 'Spacing' },
  { key: 'color', label: 'Text', cssProperty: 'color', group: 'Appearance', swatch: true },
  {
    key: 'backgroundColor',
    label: 'Fill',
    cssProperty: 'background-color',
    group: 'Appearance',
    swatch: true,
  },
  { key: 'opacity', label: 'Opacity', cssProperty: 'opacity', group: 'Appearance' },
  { key: 'borderRadius', label: 'Radius', cssProperty: 'border-radius', group: 'Appearance' },
  { key: 'borderColor', label: 'Border', cssProperty: 'border-color', group: 'Appearance', swatch: true },
  { key: 'borderWidth', label: 'Stroke', cssProperty: 'border-width', group: 'Appearance' },
  { key: 'fontFamily', label: 'Font', cssProperty: 'font-family', group: 'Appearance' },
  { key: 'fontSize', label: 'Size', cssProperty: 'font-size', group: 'Appearance' },
  { key: 'fontWeight', label: 'Weight', cssProperty: 'font-weight', group: 'Appearance' },
]

const INSPECTOR_GROUPS: InspectorGroup[] = [
  'Position',
  'Layout',
  'Dimensions',
  'Spacing',
  'Appearance',
]

const FLOW_OPTIONS = [
  { value: 'block', label: 'Block', icon: BoxIcon },
  { value: 'flex', label: 'Flex', icon: Rows2Icon },
  { value: 'grid', label: 'Grid', icon: Columns2Icon },
] as const

const DIRECTION_OPTIONS = [
  { value: 'row', label: 'Row', icon: Rows2Icon },
  { value: 'column', label: 'Column', icon: Columns2Icon },
] as const

const ALIGN_OPTIONS = [
  { value: 'flex-start', label: 'Start', icon: AlignLeftIcon },
  { value: 'center', label: 'Center', icon: AlignCenterIcon },
  { value: 'flex-end', label: 'End', icon: AlignRightIcon },
] as const

const JUSTIFY_OPTIONS = [
  { value: 'flex-start', label: 'Start', icon: AlignLeftIcon },
  { value: 'center', label: 'Center', icon: AlignCenterIcon },
  { value: 'space-between', label: 'Between', icon: AlignHorizontalSpaceBetweenIcon },
  { value: 'space-around', label: 'Around', icon: AlignHorizontalSpaceAroundIcon },
] as const

function readableStyleValue(value: string): string {
  if (!value || value === 'rgba(0, 0, 0, 0)') {
    return 'transparent'
  }
  return value.replaceAll('"', '')
}

function elementStyleValue(element: BrowserAnnotationElement, key: DesignKey): string {
  switch (key) {
    case 'color':
      return element.styles.color
    case 'backgroundColor':
      return element.styles.backgroundColor
    case 'opacity':
      return element.styles.opacity
    case 'fontFamily':
      return element.styles.fontFamily
    case 'fontSize':
      return element.styles.fontSize
    case 'fontWeight':
      return element.styles.fontWeight
    case 'borderRadius':
      return element.styles.borderRadius
    case 'borderColor':
      return element.styles.borderColor ?? ''
    case 'borderWidth':
      return element.styles.borderWidth ?? ''
    case 'display':
      return element.styles.display ?? ''
    case 'alignItems':
      return element.styles.alignItems ?? ''
    case 'justifyContent':
      return element.styles.justifyContent ?? ''
    case 'flexDirection':
      return element.styles.flexDirection ?? ''
    case 'width':
      return element.styles.width ?? ''
    case 'height':
      return element.styles.height ?? ''
    case 'marginTop':
      return element.styles.marginTop ?? ''
    case 'marginRight':
      return element.styles.marginRight ?? ''
    case 'marginBottom':
      return element.styles.marginBottom ?? ''
    case 'marginLeft':
      return element.styles.marginLeft ?? ''
    case 'paddingTop':
      return element.styles.paddingTop ?? ''
    case 'paddingRight':
      return element.styles.paddingRight ?? ''
    case 'paddingBottom':
      return element.styles.paddingBottom ?? ''
    case 'paddingLeft':
      return element.styles.paddingLeft ?? ''
    case 'rowGap':
      return element.styles.rowGap ?? ''
    case 'columnGap':
      return element.styles.columnGap ?? ''
  }
}

function parseScrubbableStyleValue(value: string): { number: number, unit: string } | null {
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)(px|rem|em|%)?$/)
  if (!match) {
    return null
  }
  return {
    number: Number(match[1]),
    unit: match[2] ?? '',
  }
}

function formatScrubbableStyleValue(value: { number: number, unit: string }): string {
  const rounded = Math.round(value.number * 100) / 100
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : String(rounded)}${value.unit}`
}

function selectorSegments(selector: string): string[] {
  return selector
    .split('>')
    .map(segment => segment.trim())
    .filter(Boolean)
}

function changedCount(designChanges: BrowserAnnotationDesignChange): number {
  return Object.values(designChanges).filter(value => Boolean(value?.trim())).length
}

function cssRows(
  element: BrowserAnnotationElement,
  designChanges: BrowserAnnotationDesignChange,
): Array<{ property: string, value: string, changed: boolean }> {
  return DESIGN_FIELDS
    .map((field) => {
      const original = elementStyleValue(element, field.key)
      const draft = designChanges[field.key]?.trim() ?? ''
      return {
        property: field.cssProperty,
        value: draft || original,
        changed: Boolean(draft),
      }
    })
    .filter(row => Boolean(row.value))
}

interface SegmentControlProps {
  value: string
  options: ReadonlyArray<{
    value: string
    label: string
    icon: typeof BoxIcon
  }>
  onChange: (value: string) => void
}

function SegmentControl({ value, options, onChange }: SegmentControlProps) {
  return (
    <div className="grid h-8 grid-flow-col auto-cols-fr rounded-full bg-foreground/5 p-0.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] dark:bg-white/6">
      {options.map(({ value: optionValue, label, icon: Icon }) => {
        const selected = value === optionValue
        return (
          <Button
            key={optionValue}
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              'h-7 min-w-0 rounded-full px-2 text-muted-foreground active:scale-[0.96]',
              selected && 'bg-primary text-primary-foreground shadow-[0_1px_3px_rgba(0,0,0,0.16),inset_0_0_0_1px_rgba(255,255,255,0.10)]',
            )}
            onClick={() => onChange(optionValue)}
            aria-label={label}
            title={label}
          >
            <Icon className="size-3.5" aria-hidden="true" />
          </Button>
        )
      })}
    </div>
  )
}

interface DesignInputProps {
  field: BrowserAnnotationDesignField
  value: string
  originalValue: string
  onChange: (value: string) => void
  onReset: () => void
}

function DesignInput({ field, value, originalValue, onChange, onReset }: DesignInputProps) {
  const changed = value.trim().length > 0
  const effectiveValue = value || originalValue
  const scrubValue = parseScrubbableStyleValue(effectiveValue)
  const readableOriginal = readableStyleValue(originalValue)

  const handleScrub = (delta: number) => {
    if (!scrubValue) {
      return
    }
    onChange(formatScrubbableStyleValue({
      number: scrubValue.number + delta,
      unit: scrubValue.unit,
    }))
  }

  if (field.key === 'display') {
    return (
      <InspectorRow label={field.label} changed={changed} onReset={onReset}>
        <SegmentControl value={effectiveValue} options={FLOW_OPTIONS} onChange={onChange} />
      </InspectorRow>
    )
  }

  if (field.key === 'flexDirection') {
    return (
      <InspectorRow label={field.label} changed={changed} onReset={onReset}>
        <SegmentControl value={effectiveValue} options={DIRECTION_OPTIONS} onChange={onChange} />
      </InspectorRow>
    )
  }

  if (field.key === 'alignItems') {
    return (
      <InspectorRow label={field.label} changed={changed} onReset={onReset}>
        <SegmentControl value={effectiveValue} options={ALIGN_OPTIONS} onChange={onChange} />
      </InspectorRow>
    )
  }

  if (field.key === 'justifyContent') {
    return (
      <InspectorRow label={field.label} changed={changed} onReset={onReset}>
        <SegmentControl value={effectiveValue} options={JUSTIFY_OPTIONS} onChange={onChange} />
      </InspectorRow>
    )
  }

  return (
    <InspectorRow label={field.label} changed={changed} onReset={onReset}>
      <span className="flex min-w-0 items-center gap-1">
        {field.swatch && (
          <BrowserColorPalette
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
    <label className="grid grid-cols-[70px_minmax(0,1fr)_28px] items-center gap-2 text-xs">
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

export function BrowserAnnotationAdjustmentPanel() {
  const adjustmentSession = useBrowserPanelStore(state => state.annotationAdjustmentSession)
  const updateDesignChanges = useBrowserPanelStore(
    state => state.updateAnnotationAdjustmentDesignChanges,
  )
  const [activeTab, setActiveTab] = useState<InspectorTab>('design')

  const selectedElement = adjustmentSession?.selectedElement
  const designChanges = adjustmentSession?.designChanges ?? {}
  const changeCount = changedCount(designChanges)

  const fieldsByGroup = (() => {
    const groups: Record<InspectorGroup, BrowserAnnotationDesignField[]> = {
      Position: [],
      Layout: [],
      Dimensions: [],
      Spacing: [],
      Appearance: [],
    }
    for (const field of DESIGN_FIELDS) {
      groups[field.group].push(field)
    }
    return groups
  })()

  const handleFieldChange = (key: DesignKey, value: string) => {
    updateDesignChanges({ [key]: value })
  }

  const handleFieldReset = (key: DesignKey) => {
    updateDesignChanges({ [key]: '' })
  }

  if (!adjustmentSession || !selectedElement) {
    return <EmptyInspector />
  }

  const segments = selectorSegments(selectedElement.selector)
  const rows = cssRows(selectedElement, designChanges)
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
          <h2 className="text-xs font-semibold text-foreground">Components</h2>
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
          {INSPECTOR_GROUPS.map((group) => {
            if (group === 'Position') {
              return (
                <InspectorSection key={group} title={group}>
                  <div className="grid grid-cols-3 gap-2">
                    <ReadOnlyMetric label="X" value={`${Math.round(selectedElement.rect.x)} px`} />
                    <ReadOnlyMetric label="Y" value={`${Math.round(selectedElement.rect.y)} px`} />
                    <ReadOnlyMetric label="Z" value="0" />
                  </div>
                </InspectorSection>
              )
            }

            const fields = fieldsByGroup[group].filter(field => Boolean(elementStyleValue(selectedElement, field.key)))
            if (fields.length === 0) {
              return null
            }

            return (
              <InspectorSection key={group} title={group}>
                {fields.map((field) => {
                  const originalValue = elementStyleValue(selectedElement, field.key)
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
          <AlignJustifyIcon className="size-3.5" />
          Apply
        </Button>
      </div>
    </div>
  )
}
