import { useCallback, useState } from 'react'

import {
  openChatSession,
  openKanbanBoard,
  openWorkspaceDetail,
} from '~/navigation/navigation-commands'
import { useBrowserPanelStore } from '~/store/browser-panel'

import { selectFileSearchResult } from './global-search-actions'
import { GlobalSearchDialogView } from './global-search-dialog-view'
import { parseInitialQuery } from './palette/modes'
import type { CommandAction, PaletteModeId } from './palette/types'
import {
  usePaletteData,
  writeCommandHistory,
} from './palette/use-palette-data'

export interface GlobalSearchDialogContentProps {
  initialQuery?: string
  onOpenChange: (open: boolean) => void
}

export function GlobalSearchDialogContent({
  initialQuery = '>',
  onOpenChange,
}: GlobalSearchDialogContentProps) {
  const close = useCallback(() => onOpenChange(false), [onOpenChange])
  const openWorkspaceFile = useBrowserPanelStore(
    state => state.openWorkspaceFileTab,
  )
  const [{ mode: initialMode, query: initialQueryText }] = useState(
    () => parseInitialQuery(initialQuery),
  )
  const [query, setQuery] = useState(initialQueryText)
  const [mode, setMode] = useState<PaletteModeId>(initialMode)
  const data = usePaletteData({ mode, query, close })

  const handleSelectCommand = useCallback((command: CommandAction) => {
    writeCommandHistory(command.id)
    void command.handler()
  }, [])

  const handleSelectFile = useCallback((filePath: string) => {
    if (!data.fileWorkspaceId) {
      return
    }
    selectFileSearchResult({
      workspaceId: data.fileWorkspaceId,
      filePath,
      close,
      openWorkspaceFile,
    })
  }, [close, data.fileWorkspaceId, openWorkspaceFile])

  const handleSelectThread = useCallback((sessionId: string) => {
    close()
    openChatSession(sessionId)
  }, [close])

  const handleSelectWorkspace = useCallback((workspaceId: string) => {
    close()
    openWorkspaceDetail(workspaceId)
  }, [close])

  const handleSelectIssue = useCallback((issueId: string) => {
    close()
    if (data.boardId) {
      openKanbanBoard({ boardId: data.boardId, issueId })
    }
  }, [close, data.boardId])

  return (
    <GlobalSearchDialogView
      mode={mode}
      query={query}
      data={data}
      onModeChange={setMode}
      onQueryChange={setQuery}
      onSelectCommand={handleSelectCommand}
      onSelectFile={handleSelectFile}
      onSelectThread={handleSelectThread}
      onSelectWorkspace={handleSelectWorkspace}
      onSelectIssue={handleSelectIssue}
      onDismiss={close}
    />
  )
}
