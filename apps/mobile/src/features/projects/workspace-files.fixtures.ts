import type { WorkspaceFilesViewProps } from './workspace-files-view-contract'

export const workspaceFilesFixture: WorkspaceFilesViewProps = {
  currentPath: 'apps/mobile/src',
  entries: [
    { name: 'features', path: 'apps/mobile/src/features', type: 'directory' },
    { name: 'app.tsx', path: 'apps/mobile/src/app.tsx', type: 'file' },
  ],
  onBack: () => {},
  onOpenDirectory: () => {},
  onOpenFile: () => {},
  onSearchChange: () => {},
  search: '',
}
