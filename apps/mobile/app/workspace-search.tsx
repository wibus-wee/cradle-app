import { useLocalSearchParams } from 'expo-router'

import { WorkspaceSearchContainer } from '@/features/projects/WorkspaceSearchContainer'

export default function WorkspaceSearchRoute() {
  const { workspaceId } = useLocalSearchParams<{ workspaceId: string }>()
  return <WorkspaceSearchContainer workspaceId={workspaceId} />
}
