interface IdRecord {
  id: string
}

export function toggleSelectedId(selectedIds: Set<string>, id: string): Set<string> {
  const next = new Set(selectedIds)
  if (next.has(id)) {
    next.delete(id)
  }
 else {
    next.add(id)
  }
  return next
}

export function selectedIdFromSet(selectedIds: Set<string>): string | null {
  if (selectedIds.size !== 1) {
    return null
  }
  return selectedIds.values().next().value ?? null
}

export function selectedRecords<T extends IdRecord>(records: T[], selectedIds: Set<string>): T[] {
  return records.filter(record => selectedIds.has(record.id))
}

export function pruneSelectedIds(selectedIds: Set<string>, availableIds: Set<string>): Set<string> {
  const next = new Set([...selectedIds].filter(id => availableIds.has(id)))
  if (next.size === selectedIds.size) {
    return selectedIds
  }
  return next
}

export function mergeVisibleSelection<T extends IdRecord>(
  selectedIds: Set<string>,
  visibleRecords: T[],
): Set<string> {
  const next = new Set(selectedIds)
  for (const record of visibleRecords) {
    next.add(record.id)
  }
  return next
}

export function removeVisibleSelection<T extends IdRecord>(
  selectedIds: Set<string>,
  visibleRecords: T[],
): Set<string> {
  const next = new Set(selectedIds)
  for (const record of visibleRecords) {
    next.delete(record.id)
  }
  return next
}

export function applyVisibleRangeSelection<T extends IdRecord>(
  selectedIds: Set<string>,
  visibleRecords: T[],
  anchorId: string | null,
  targetId: string,
  selected: boolean,
): Set<string> {
  const next = new Set(selectedIds)
  const anchorIndex = anchorId
    ? visibleRecords.findIndex(record => record.id === anchorId)
    : -1
  const targetIndex = visibleRecords.findIndex(record => record.id === targetId)

  if (anchorIndex < 0 || targetIndex < 0) {
    if (selected) {
      next.add(targetId)
    }
 else {
      next.delete(targetId)
    }
    return next
  }

  const startIndex = Math.min(anchorIndex, targetIndex)
  const endIndex = Math.max(anchorIndex, targetIndex)
  for (const record of visibleRecords.slice(startIndex, endIndex + 1)) {
    if (selected) {
      next.add(record.id)
    }
 else {
      next.delete(record.id)
    }
  }
  return next
}

export function visibleRecordsAreSelected<T extends IdRecord>(
  visibleRecords: T[],
  selectedIds: Set<string>,
): boolean {
  return visibleRecords.length > 0 && visibleRecords.every(record => selectedIds.has(record.id))
}
