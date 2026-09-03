import type { WorkListItem, WorkListWorkspace } from './work-list-view-contract'

export const workGroupTitles = ['Today', 'This week', 'Older'] as const

export function activityTone(activity: WorkListItem['activity']) {
  if (activity === 'running') { return 'success' as const }
  if (activity === 'waiting') { return 'warning' as const }
  if (activity === 'blocked') { return 'danger' as const }
  return 'neutral' as const
}

export function workGroup(updatedAt: number): typeof workGroupTitles[number] {
  const timestamp = updatedAt < 10_000_000_000 ? updatedAt * 1_000 : updatedAt
  const age = Date.now() - timestamp
  if (age < 86_400_000) { return 'Today' }
  if (age < 604_800_000) { return 'This week' }
  return 'Older'
}

export function workMatchesSearch(
  work: WorkListItem,
  workspaces: WorkListWorkspace[],
  normalizedSearch: string,
) {
  const workspaceName = workspaces.find(workspace => workspace.id === work.workspaceId)?.name
  return [work.title, work.objective, workspaceName]
    .some(value => value?.toLocaleLowerCase().includes(normalizedSearch))
}
