import { useLocalSearchParams } from 'expo-router'

import { WorkspaceDirectoryContainer } from '@/features/projects/WorkspaceDirectoryContainer'

export default function WorkspaceDirectoryRoute() {
  const { workspaceId, path } = useLocalSearchParams<{ workspaceId: string, path: string }>()
  return <WorkspaceDirectoryContainer workspaceId={workspaceId} path={path} />
}
