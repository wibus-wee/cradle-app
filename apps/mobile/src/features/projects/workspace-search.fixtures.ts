import type { WorkspaceSearchViewProps } from './WorkspaceSearchView'

export const workspaceSearchFixture: WorkspaceSearchViewProps = {
  error: null,
  isSearching: false,
  onOpenDirectory: () => {},
  onOpenFile: () => {},
  onQueryChange: () => {},
  onRetry: () => {},
  query: 'workspace',
  results: [
    { type: 'file', name: 'WorkspaceView.tsx', path: 'apps/mobile/src/features/projects/WorkspaceView.tsx' },
    { type: 'directory', name: 'workspace', path: 'apps/web/src/features/workspace' },
  ],
}
