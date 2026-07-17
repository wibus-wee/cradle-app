import type { CodeViewItem } from '@pierre/diffs'
import { parsePatchFiles } from '@pierre/diffs'

export interface DiffData<TAnnotation = undefined> {
  items: CodeViewItem<TAnnotation>[]
  itemIdToPath: Map<string, string>
  pathToItemId: Map<string, string>
  whitespaceOnlyPaths: Set<string>
}

function hashText(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function createItemId(
  path: string,
  itemIds: Set<string>,
  nextCollisionSuffixByBase: Map<string, number>,
): string {
  if (!itemIds.has(path)) {
    return path
  }

  let suffix = nextCollisionSuffixByBase.get(path) ?? 2
  let itemId = `${path}?${suffix}`
  while (itemIds.has(itemId)) {
    suffix++
    itemId = `${path}?${suffix}`
  }
  nextCollisionSuffixByBase.set(path, suffix + 1)
  return itemId
}

function normalizeWhitespace(line: string): string {
  return line.replace(/\s+/g, '')
}

function isWhitespaceOnlyFileDiff(
  fileDiff: Extract<CodeViewItem, { type: 'diff' }>['fileDiff'],
): boolean {
  if (fileDiff.type === 'rename-pure') {
    return false
  }
  const oldContent = fileDiff.deletionLines.map(normalizeWhitespace).join('\n')
  const newContent = fileDiff.additionLines.map(normalizeWhitespace).join('\n')
  return oldContent === newContent
}

export function buildDiffData<TAnnotation = undefined>(patch: string): DiffData<TAnnotation> {
  if (patch.trim().length === 0) {
    return emptyDiffData<TAnnotation>()
  }

  const patchVersion = hashText(patch)
  const parsed = parsePatchFiles(
    patch,
    `cradle-diff-${patch.length.toString(36)}-${patchVersion.toString(36)}`,
  )
  const items: CodeViewItem<TAnnotation>[] = []
  const itemIdToPath = new Map<string, string>()
  const pathToItemId = new Map<string, string>()
  const whitespaceOnlyPaths = new Set<string>()
  const itemIds = new Set<string>()
  const nextCollisionSuffixByBase = new Map<string, number>()

  for (const parsedPatch of parsed) {
    for (const fileDiff of parsedPatch.files) {
      const itemId = createItemId(fileDiff.name, itemIds, nextCollisionSuffixByBase)
      const whitespaceOnly = isWhitespaceOnlyFileDiff(fileDiff)
      itemIds.add(itemId)
      items.push({ id: itemId, type: 'diff', fileDiff, version: patchVersion })
      itemIdToPath.set(itemId, fileDiff.name)
      pathToItemId.set(fileDiff.name, itemId)
      if (whitespaceOnly) {
        whitespaceOnlyPaths.add(fileDiff.name)
      }
      if (fileDiff.prevName) {
        pathToItemId.set(fileDiff.prevName, itemId)
        if (whitespaceOnly) {
          whitespaceOnlyPaths.add(fileDiff.prevName)
        }
      }
    }
  }

  return { items, itemIdToPath, pathToItemId, whitespaceOnlyPaths }
}

export function emptyDiffData<TAnnotation = undefined>(): DiffData<TAnnotation> {
  return {
    items: [],
    itemIdToPath: new Map(),
    pathToItemId: new Map(),
    whitespaceOnlyPaths: new Set(),
  }
}

export function diffContentCacheKey(prefix: string, path: string, content: string): string {
  return `${prefix}:${path}:${content.length.toString(36)}:${hashText(content).toString(36)}`
}
