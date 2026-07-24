import type { CSSProperties } from 'react'

import type {
  BrowserAnnotationAnchor,
  BrowserAnnotationDesignChange,
  BrowserAnnotationRecord,
} from '~/store/browser-panel'

export function formatBrowserAnnotationAnchor(
  anchor: BrowserAnnotationAnchor,
): string {
  if (anchor.kind === 'point') {
    return `point (${Math.round(anchor.x)}, ${Math.round(anchor.y)})`
  }
  if (anchor.kind === 'element') {
    const rect = anchor.element.rect
    return `element <${anchor.element.tagName.toLowerCase()}> (${Math.round(rect.x)}, ${Math.round(rect.y)}, ${Math.round(rect.width)} x ${Math.round(rect.height)})`
  }
  if (anchor.kind === 'text') {
    const excerpt = `${anchor.text.slice(0, 96)}${anchor.text.length > 96 ? '...' : ''}`
    return `text "${excerpt}" (${Math.round(anchor.x)}, ${Math.round(anchor.y)}, ${Math.round(anchor.width)} x ${Math.round(anchor.height)})`
  }
  return `region (${Math.round(anchor.x)}, ${Math.round(anchor.y)}, ${Math.round(anchor.width)} x ${Math.round(anchor.height)})`
}

export function formatBrowserAnnotationSummary(
  annotation: BrowserAnnotationRecord,
): string {
  if (annotation.body) {
    return annotation.body
  }
  if (annotation.designChange) {
    return 'Design change'
  }
  if (annotation.attachedImages.length > 0) {
    const suffix = annotation.attachedImages.length === 1 ? '' : 's'
    return `${annotation.attachedImages.length} attached image${suffix}`
  }
  return formatBrowserAnnotationAnchor(annotation.anchor)
}

export function countBrowserAnnotationDesignChanges(
  designChange: BrowserAnnotationDesignChange | null,
): number {
  if (!designChange) {
    return 0
  }
  return Object.values(designChange)
    .filter(value => Boolean(value?.trim()))
    .length
}

export function getBrowserAnnotationPreviewTarget(
  annotation: BrowserAnnotationRecord,
): { style: CSSProperties, mode: 'point' | 'rect' } | null {
  const { width, height } = annotation.surfaceSize
  if (width <= 0 || height <= 0) {
    return null
  }
  if (annotation.anchor.kind === 'point') {
    return {
      mode: 'point',
      style: {
        left: `${(annotation.anchor.x / width) * 100}%`,
        top: `${(annotation.anchor.y / height) * 100}%`,
      },
    }
  }

  const rect = annotation.anchor.kind === 'element'
    ? annotation.anchor.element.rect
    : annotation.anchor

  return {
    mode: 'rect',
    style: {
      left: `${(rect.x / width) * 100}%`,
      top: `${(rect.y / height) * 100}%`,
      width: `${(rect.width / width) * 100}%`,
      height: `${(rect.height / height) * 100}%`,
    },
  }
}
