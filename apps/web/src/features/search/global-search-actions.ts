interface SelectFileResultOptions {
  workspaceId: string
  filePath: string
  close: () => void
  openWorkspaceFile: (input: { workspaceId: string, path: string, view: 'editor' | 'preview' }) => void
  setBrowserPanelOpen: (open: boolean) => void
}

export function selectFileSearchResult({
  workspaceId,
  filePath,
  close,
  openWorkspaceFile,
  setBrowserPanelOpen,
}: SelectFileResultOptions): void {
  close()
  openWorkspaceFile({ workspaceId, path: filePath, view: 'editor' })
  setBrowserPanelOpen(true)
}
