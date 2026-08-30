import { useLocalSearchParams } from 'expo-router'

import { WorkspaceFilesContainer } from '@/features/projects/WorkspaceFilesContainer'

export default function WorkspaceFilesRoute() {
  const { workspaceId, path, file } = useLocalSearchParams<{
    workspaceId: string
    path?: string
    file?: string
  }>()
  return (
    <WorkspaceFilesContainer
      initialFile={file}
      initialPath={path}
      workspaceId={workspaceId}
    />
  )
}
