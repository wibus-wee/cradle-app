import type { WorkspaceSummary } from './projects-view-contract'

export function workspaceMatchesSearch(
  { workspace }: WorkspaceSummary,
  normalizedSearch: string,
): boolean {
  return [
    workspace.name,
    workspace.identifier,
    workspace.gitIdentity.branch,
  ].some(value => value?.toLocaleLowerCase().includes(normalizedSearch))
}
