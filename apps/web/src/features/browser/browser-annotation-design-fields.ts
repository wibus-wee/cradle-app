// FILE: browser-annotation-design-fields.ts
// Purpose: Field model for the browser annotation design inspector (labels, groups, segment options, value helpers).
// Layer: Browser feature domain data
// Depends on: BrowserPanel store annotation contracts

import type {
  BrowserAnnotationDesignChange,
  BrowserAnnotationDesignStyleKey,
  BrowserAnnotationElement,
} from '~/store/browser-panel'
import { BROWSER_ANNOTATION_DESIGN_CSS_PROPERTIES } from '~/store/browser-panel'

export type BrowserAnnotationInspectorGroup
  = | 'Layout'
    | 'Dimensions'
    | 'Spacing'
    | 'Typography'
    | 'Fill'
    | 'Stroke'
    | 'Effects'

export interface BrowserAnnotationSegmentOption {
  value: string
  label: string
  /** Rendered instead of an icon; keeps segments usable for text-only choices. */
  text: string
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
}

export interface BrowserAnnotationDesignFieldDefinition {
  key: BrowserAnnotationDesignStyleKey
  label: string
  group: BrowserAnnotationInspectorGroup
  control: 'input' | 'color' | 'segment'
  segmentOptions?: readonly BrowserAnnotationSegmentOption[]
  segmentColumns?: number
}

function textOptions(
  options: ReadonlyArray<[value: string, label: string, text: string]>,
): BrowserAnnotationSegmentOption[] {
  return options.map(([value, label, text]) => ({ value, label, text }))
}

export const BROWSER_ANNOTATION_POSITION_OPTIONS = textOptions([
  ['static', 'Static', 'Static'],
  ['relative', 'Relative', 'Rel'],
  ['absolute', 'Absolute', 'Abs'],
  ['fixed', 'Fixed', 'Fixed'],
  ['sticky', 'Sticky', 'Sticky'],
])

export const BROWSER_ANNOTATION_DISPLAY_OPTIONS = textOptions([
  ['block', 'Block', 'Block'],
  ['flex', 'Flex', 'Flex'],
  ['grid', 'Grid', 'Grid'],
  ['inline-block', 'Inline block', 'Inline'],
])

export const BROWSER_ANNOTATION_DIRECTION_OPTIONS = textOptions([
  ['row', 'Row', 'Row'],
  ['column', 'Column', 'Column'],
])

export const BROWSER_ANNOTATION_WRAP_OPTIONS = textOptions([
  ['nowrap', 'No wrap', 'No wrap'],
  ['wrap', 'Wrap', 'Wrap'],
])

export const BROWSER_ANNOTATION_ALIGN_OPTIONS = textOptions([
  ['flex-start', 'Align start', 'Start'],
  ['center', 'Align center', 'Center'],
  ['flex-end', 'Align end', 'End'],
  ['stretch', 'Stretch', 'Str'],
])

export const BROWSER_ANNOTATION_JUSTIFY_OPTIONS = textOptions([
  ['flex-start', 'Justify start', 'Start'],
  ['center', 'Justify center', 'Center'],
  ['flex-end', 'Justify end', 'End'],
  ['space-between', 'Space between', 'Btwn'],
  ['space-around', 'Space around', 'Arnd'],
])

export const BROWSER_ANNOTATION_OVERFLOW_OPTIONS = textOptions([
  ['visible', 'Visible', 'Show'],
  ['hidden', 'Hidden', 'Clip'],
  ['auto', 'Auto', 'Auto'],
  ['scroll', 'Scroll', 'Scroll'],
])

export const BROWSER_ANNOTATION_TEXT_ALIGN_OPTIONS = textOptions([
  ['left', 'Align left', 'Left'],
  ['center', 'Align center', 'Center'],
  ['right', 'Align right', 'Right'],
  ['justify', 'Justify', 'Just'],
])

export const BROWSER_ANNOTATION_FONT_STYLE_OPTIONS: readonly BrowserAnnotationSegmentOption[] = [
  { value: 'normal', label: 'Regular', text: 'Ag' },
  { value: 'italic', label: 'Italic', text: 'Ag', italic: true },
]

export const BROWSER_ANNOTATION_TEXT_TRANSFORM_OPTIONS = textOptions([
  ['none', 'No transform', '–'],
  ['uppercase', 'Uppercase', 'AG'],
  ['capitalize', 'Capitalize', 'Ag'],
  ['lowercase', 'Lowercase', 'ag'],
])

export const BROWSER_ANNOTATION_TEXT_DECORATION_OPTIONS: readonly BrowserAnnotationSegmentOption[] = [
  { value: 'none', label: 'No decoration', text: '–' },
  { value: 'underline', label: 'Underline', text: 'U', underline: true },
  { value: 'line-through', label: 'Strikethrough', text: 'S', strikethrough: true },
]

export const BROWSER_ANNOTATION_BORDER_STYLE_OPTIONS = textOptions([
  ['none', 'No border', 'None'],
  ['solid', 'Solid', 'Solid'],
  ['dashed', 'Dashed', 'Dash'],
  ['dotted', 'Dotted', 'Dot'],
])

export const BROWSER_ANNOTATION_DESIGN_FIELDS: readonly BrowserAnnotationDesignFieldDefinition[] = [
  { key: 'display', label: 'Flow', group: 'Layout', control: 'segment', segmentOptions: BROWSER_ANNOTATION_DISPLAY_OPTIONS },
  { key: 'flexDirection', label: 'Direction', group: 'Layout', control: 'segment', segmentOptions: BROWSER_ANNOTATION_DIRECTION_OPTIONS },
  { key: 'flexWrap', label: 'Wrap', group: 'Layout', control: 'segment', segmentOptions: BROWSER_ANNOTATION_WRAP_OPTIONS },
  { key: 'alignItems', label: 'Align', group: 'Layout', control: 'segment', segmentOptions: BROWSER_ANNOTATION_ALIGN_OPTIONS },
  { key: 'justifyContent', label: 'Justify', group: 'Layout', control: 'segment', segmentOptions: BROWSER_ANNOTATION_JUSTIFY_OPTIONS, segmentColumns: 5 },
  { key: 'rowGap', label: 'Row gap', group: 'Layout', control: 'input' },
  { key: 'columnGap', label: 'Col gap', group: 'Layout', control: 'input' },
  { key: 'overflow', label: 'Overflow', group: 'Layout', control: 'segment', segmentOptions: BROWSER_ANNOTATION_OVERFLOW_OPTIONS },
  { key: 'width', label: 'W', group: 'Dimensions', control: 'input' },
  { key: 'height', label: 'H', group: 'Dimensions', control: 'input' },
  { key: 'paddingTop', label: 'Pad top', group: 'Spacing', control: 'input' },
  { key: 'paddingRight', label: 'Pad right', group: 'Spacing', control: 'input' },
  { key: 'paddingBottom', label: 'Pad bottom', group: 'Spacing', control: 'input' },
  { key: 'paddingLeft', label: 'Pad left', group: 'Spacing', control: 'input' },
  { key: 'marginTop', label: 'Mar top', group: 'Spacing', control: 'input' },
  { key: 'marginRight', label: 'Mar right', group: 'Spacing', control: 'input' },
  { key: 'marginBottom', label: 'Mar bottom', group: 'Spacing', control: 'input' },
  { key: 'marginLeft', label: 'Mar left', group: 'Spacing', control: 'input' },
  { key: 'fontFamily', label: 'Font', group: 'Typography', control: 'input' },
  { key: 'fontSize', label: 'Size', group: 'Typography', control: 'input' },
  { key: 'fontWeight', label: 'Weight', group: 'Typography', control: 'input' },
  { key: 'lineHeight', label: 'Line height', group: 'Typography', control: 'input' },
  { key: 'letterSpacing', label: 'Spacing', group: 'Typography', control: 'input' },
  { key: 'fontStyle', label: 'Style', group: 'Typography', control: 'segment', segmentOptions: BROWSER_ANNOTATION_FONT_STYLE_OPTIONS },
  { key: 'textAlign', label: 'Align', group: 'Typography', control: 'segment', segmentOptions: BROWSER_ANNOTATION_TEXT_ALIGN_OPTIONS },
  { key: 'textTransform', label: 'Case', group: 'Typography', control: 'segment', segmentOptions: BROWSER_ANNOTATION_TEXT_TRANSFORM_OPTIONS },
  { key: 'textDecorationLine', label: 'Decoration', group: 'Typography', control: 'segment', segmentOptions: BROWSER_ANNOTATION_TEXT_DECORATION_OPTIONS },
  { key: 'color', label: 'Text', group: 'Typography', control: 'color' },
  { key: 'backgroundColor', label: 'Fill', group: 'Fill', control: 'color' },
  { key: 'opacity', label: 'Opacity', group: 'Fill', control: 'input' },
  { key: 'borderColor', label: 'Colour', group: 'Stroke', control: 'color' },
  { key: 'borderWidth', label: 'Width', group: 'Stroke', control: 'input' },
  { key: 'borderStyle', label: 'Style', group: 'Stroke', control: 'segment', segmentOptions: BROWSER_ANNOTATION_BORDER_STYLE_OPTIONS },
  { key: 'borderRadius', label: 'Radius', group: 'Effects', control: 'input' },
  { key: 'boxShadow', label: 'Shadow', group: 'Effects', control: 'input' },
]

export const BROWSER_ANNOTATION_INSPECTOR_GROUPS: readonly BrowserAnnotationInspectorGroup[] = [
  'Layout',
  'Dimensions',
  'Spacing',
  'Typography',
  'Fill',
  'Stroke',
  'Effects',
]

const CSS_PROPERTY_BY_KEY = new Map(
  BROWSER_ANNOTATION_DESIGN_CSS_PROPERTIES.map(({ key, property }) => [key, property]),
)

export function browserAnnotationCssProperty(key: BrowserAnnotationDesignStyleKey): string {
  return CSS_PROPERTY_BY_KEY.get(key) ?? key
}

export function browserAnnotationElementStyleValue(
  element: BrowserAnnotationElement,
  key: BrowserAnnotationDesignStyleKey,
): string {
  return element.styles[key] ?? ''
}

export function readableBrowserAnnotationStyleValue(value: string): string {
  if (!value || value === 'rgba(0, 0, 0, 0)') {
    return 'transparent'
  }
  return value.replaceAll('"', '')
}

/** Computed text-align resolves writing-mode keywords the segment does not offer. */
export function normalizedBrowserAnnotationSegmentValue(
  key: BrowserAnnotationDesignStyleKey,
  value: string,
): string {
  if (key !== 'textAlign') {
    return value
  }
  if (value === 'start') {
    return 'left'
  }
  if (value === 'end') {
    return 'right'
  }
  return value
}

export function parseBrowserAnnotationScrubValue(
  value: string,
): { number: number, unit: string } | null {
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)(px|rem|em|%)?$/)
  if (!match) {
    return null
  }
  return {
    number: Number(match[1]),
    unit: match[2] ?? '',
  }
}

export function formatBrowserAnnotationScrubValue(value: { number: number, unit: string }): string {
  const rounded = Math.round(value.number * 100) / 100
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : String(rounded)}${value.unit}`
}

export function browserAnnotationSelectorSegments(selector: string): string[] {
  return selector
    .split('>')
    .map(segment => segment.trim())
    .filter(Boolean)
}

export function countBrowserAnnotationDraftChanges(designChanges: BrowserAnnotationDesignChange): number {
  return Object.values(designChanges).filter(value => Boolean(value?.trim())).length
}

export interface BrowserAnnotationCssRow {
  property: string
  value: string
  changed: boolean
}

export function browserAnnotationCssRows(
  element: BrowserAnnotationElement,
  designChanges: BrowserAnnotationDesignChange,
): BrowserAnnotationCssRow[] {
  return BROWSER_ANNOTATION_DESIGN_CSS_PROPERTIES
    .map(({ key, property }) => {
      const original = browserAnnotationElementStyleValue(element, key)
      const draft = designChanges[key]?.trim() ?? ''
      return {
        property,
        value: draft || original,
        changed: Boolean(draft),
      }
    })
    .filter(row => Boolean(row.value))
}
