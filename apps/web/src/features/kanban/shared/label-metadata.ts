import type { KanbanIssue } from '~/features/kanban/types'

export type LabelTone = 'blue' | 'green' | 'amber' | 'rose' | 'violet' | 'cyan' | 'slate'

export interface WorkspaceLabelOption {
  label: string
  count: number
  tone: LabelTone
}

export interface IssueLabelsPatch {
  issueId: string
  labels: string[]
}

const LABEL_TONES: LabelTone[] = ['blue', 'green', 'amber', 'rose', 'violet', 'cyan', 'slate']

function normalizeLabel(label: string): string {
  return label.trim().toLowerCase()
}

export function getLabelTone(label: string): LabelTone {
  const normalized = normalizeLabel(label)
  let hash = 0

  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash * 31 + normalized.charCodeAt(index)) >>> 0
  }

  return LABEL_TONES[hash % LABEL_TONES.length] ?? 'slate'
}

export function collectWorkspaceLabelOptions(issues: KanbanIssue[]): WorkspaceLabelOption[] {
  const labelsByKey = new Map<string, { label: string, count: number }>()

  for (const issue of issues) {
    for (const label of issue.labels) {
      const trimmed = label.trim()
      if (!trimmed) {
        continue
      }

      const key = normalizeLabel(trimmed)
      const current = labelsByKey.get(key)

      if (current) {
        current.count += 1
      }
      else {
        labelsByKey.set(key, { label: trimmed, count: 1 })
      }
    }
  }

  return Array.from(labelsByKey.values(), option => ({
      ...option,
      tone: getLabelTone(option.label),
    }))
    .toSorted((left, right) => {
      const countDelta = right.count - left.count
      if (countDelta !== 0) {
        return countDelta
      }

      return left.label.localeCompare(right.label)
    })
}

export function filterWorkspaceLabelOptions(
  options: WorkspaceLabelOption[],
  query: string,
  selectedLabels: string[],
): WorkspaceLabelOption[] {
  const normalizedQuery = normalizeLabel(query)
  const selectedKeys = new Set(selectedLabels.map(normalizeLabel))

  return options.filter((option) => {
    if (selectedKeys.has(normalizeLabel(option.label))) {
      return false
    }

    if (!normalizedQuery) {
      return true
    }

    return normalizeLabel(option.label).includes(normalizedQuery)
  })
}

function renameLabels(labels: string[], sourceLabel: string, targetLabel: string): string[] {
  const sourceKey = normalizeLabel(sourceLabel)
  const target = targetLabel.trim()
  const targetKey = normalizeLabel(target)

  if (!sourceKey || !target || sourceKey === targetKey) {
    return labels
  }

  const nextLabels: string[] = []
  let targetAlreadyAdded = false

  for (const label of labels) {
    const key = normalizeLabel(label)

    if (key === sourceKey) {
      if (!targetAlreadyAdded && !nextLabels.some(item => normalizeLabel(item) === targetKey)) {
        nextLabels.push(target)
        targetAlreadyAdded = true
      }
      continue
    }

    if (key === targetKey) {
      if (!targetAlreadyAdded) {
        nextLabels.push(label)
        targetAlreadyAdded = true
      }
      continue
    }

    nextLabels.push(label)
  }

  return nextLabels
}

function removeLabel(labels: string[], labelToRemove: string): string[] {
  const labelKey = normalizeLabel(labelToRemove)

  if (!labelKey) {
    return labels
  }

  return labels.filter(label => normalizeLabel(label) !== labelKey)
}

function labelsChanged(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return true
  }

  return left.some((label, index) => label !== right[index])
}

export function buildRenameLabelPatches(
  issues: KanbanIssue[],
  sourceLabel: string,
  targetLabel: string,
): IssueLabelsPatch[] {
  return issues.flatMap((issue) => {
    const labels = renameLabels(issue.labels, sourceLabel, targetLabel)

    return labelsChanged(issue.labels, labels)
      ? [{ issueId: issue.id, labels }]
      : []
  })
}

export function buildDeleteLabelPatches(issues: KanbanIssue[], labelToDelete: string): IssueLabelsPatch[] {
  return issues.flatMap((issue) => {
    const labels = removeLabel(issue.labels, labelToDelete)

    return labelsChanged(issue.labels, labels)
      ? [{ issueId: issue.id, labels }]
      : []
  })
}
