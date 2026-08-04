import { useLocalSearchParams } from 'expo-router'

import { WorkDetailContainer } from '@/features/work/WorkDetailContainer'

export default function WorkDetailRoute() {
  const { workId } = useLocalSearchParams<{ workId: string }>()
  return <WorkDetailContainer workId={workId} />
}
