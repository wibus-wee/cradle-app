import type { WorkspaceDirectoryViewProps } from './WorkspaceDirectoryView'

export const workspaceDirectoryFixture: WorkspaceDirectoryViewProps = {
  entries: [
    { type: 'directory', name: 'mobile', path: 'apps/mobile' },
    { type: 'file', name: 'package.json', path: 'apps/package.json' },
  ],
  onOpenDirectory: () => {},
  onOpenFile: () => {},
  onRefresh: () => {},
}

export const emptyWorkspaceDirectoryFixture: WorkspaceDirectoryViewProps = {
  entries: [],
  onOpenDirectory: () => {},
  onOpenFile: () => {},
  onRefresh: () => {},
}
