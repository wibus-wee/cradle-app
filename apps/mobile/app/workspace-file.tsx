import { useLocalSearchParams } from 'expo-router'

import { FilePreviewContainer } from '@/features/projects/FilePreviewContainer'

export default function WorkspaceFileRoute() {
  const { workspaceId, path } = useLocalSearchParams<{ workspaceId: string, path: string }>()
  return <FilePreviewContainer workspaceId={workspaceId} path={path} />
}
