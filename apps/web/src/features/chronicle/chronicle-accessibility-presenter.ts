import type { TFunction } from 'i18next'
import { z } from 'zod'

import type { ChronicleAccessibilitySnapshot } from './use-chronicle'

type ChronicleTranslate = TFunction<'chronicle'>

const AccessibilityTreeNodeSchema = z.object({
  role: z.string().nullable().optional().transform(value => value?.trim() || 'AXElement'),
  label: z.union([z.string(), z.number(), z.boolean()]).nullable().optional().transform(value => value === null || value === undefined ? '' : String(value)),
  value: z.union([z.string(), z.number(), z.boolean()]).nullable().optional().transform(value => value === null || value === undefined ? '' : String(value)),
  depth: z.coerce.number().finite().nullable().optional().transform(value => value ?? 0),
  path: z.string().min(1).nullable().optional(),
}).passthrough().transform(node => ({
  role: node.role,
  label: node.label,
  value: node.value,
  depth: node.depth,
  path: node.path ?? `${node.role}:${node.label}:${node.depth}`,
}))

const AccessibilitySnapshotMetadataSchema = z.object({
  artifactPath: z.string().optional(),
}).passthrough()

export type ChronicleAccessibilityTreeNode = z.output<typeof AccessibilityTreeNodeSchema>

export function formatChronicleAccessibilityStatus(
  t: ChronicleTranslate,
  status: ChronicleAccessibilitySnapshot['status'],
): string {
  if (status === 'permission-denied') {
    return t('accessibility.status.permissionDenied')
  }
  if (status === 'unavailable') {
    return t('common.status.unavailable')
  }
  if (status === 'error') {
    return t('common.status.error')
  }
  return t('resource.state.available')
}

export function formatChronicleAccessibilityEventNotification(
  t: ChronicleTranslate,
  notification: string,
): string {
  if (notification === 'AXFocusedWindowChanged') {
    return t('accessibility.notification.focusedWindowChanged')
  }
  if (notification === 'AXFocusedUIElementChanged') {
    return t('accessibility.notification.focusedElementChanged')
  }
  if (notification === 'AXWindowCreated') {
    return t('accessibility.notification.windowCreated')
  }
  if (notification === 'AXWindowMoved') {
    return t('accessibility.notification.windowMoved')
  }
  if (notification === 'AXWindowResized') {
    return t('accessibility.notification.windowResized')
  }
  return notification
}

export function getChronicleAccessibilityArtifactPath(
  metadata: ChronicleAccessibilitySnapshot['metadata'],
): string | undefined {
  return AccessibilitySnapshotMetadataSchema.parse(metadata).artifactPath
}

export function getChronicleAccessibilityTreeNodes(
  tree: ChronicleAccessibilitySnapshot['tree'],
  limit = 4,
): ChronicleAccessibilityTreeNode[] {
  return tree.reduce<ChronicleAccessibilityTreeNode[]>((items, node) => {
    if (items.length >= limit) {
      return items
    }

    const parsed = AccessibilityTreeNodeSchema.safeParse(node)
    if (parsed.success) {
      items.push(parsed.data)
    }
    return items
  }, [])
}

export function getChronicleAccessibilityTreeDepthClass(depth: number): string {
  if (depth <= 0) {
    return 'pl-0'
  }
  if (depth === 1) {
    return 'pl-2'
  }
  if (depth === 2) {
    return 'pl-4'
  }
  if (depth === 3) {
    return 'pl-6'
  }
  return 'pl-8'
}
