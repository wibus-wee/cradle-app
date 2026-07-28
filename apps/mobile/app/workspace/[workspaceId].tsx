import { useLocalSearchParams } from 'expo-router'

import { WorkspaceContainer } from '@/features/projects/WorkspaceContainer'

export default function WorkspaceRoute() {
  const { workspaceId } = useLocalSearchParams<{ workspaceId: string }>()
  return <WorkspaceContainer workspaceId={workspaceId} />
}
