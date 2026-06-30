import type { ThreadSearchHit } from '~/features/search/types'

export interface GroupedSearchHits {
  value: string
  label: string
  items: ThreadSearchHit[]
}

export function groupHitsByWorkspace(hits: ThreadSearchHit[]): GroupedSearchHits[] {
  const groupsByWorkspace = new Map<string, GroupedSearchHits>()

  for (const hit of hits) {
    const workspaceKey = hit.workspaceId ?? '__no_workspace__'
    const existingGroup = groupsByWorkspace.get(workspaceKey)
    if (existingGroup) {
      existingGroup.items.push(hit)
      continue
    }

    groupsByWorkspace.set(workspaceKey, {
      value: workspaceKey,
      label: hit.workspaceName ?? 'Untitled workspace',
      items: [hit],
    })
  }

  return [...groupsByWorkspace.values()]
}
