type TreeItemKind = 'file' | 'directory'

export function resolveTreeItemFromEvent(event: Event): { path: string, kind: TreeItemKind } | null {
  const target = event.target instanceof HTMLElement
    ? event.target.closest('[data-item-path]')
    : null

  if (target instanceof HTMLElement && target.dataset.itemPath) {
    return {
      path: target.dataset.itemPath,
      kind: target.dataset.itemType === 'folder' ? 'directory' : 'file',
    }
  }

  for (const entry of event.composedPath()) {
    if (entry instanceof HTMLElement && entry.dataset.itemPath) {
      return {
        path: entry.dataset.itemPath,
        kind: entry.dataset.itemType === 'folder' ? 'directory' : 'file',
      }
    }
  }

  return null
}
