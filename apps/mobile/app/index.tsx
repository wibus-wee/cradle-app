import { Redirect } from 'expo-router'

import { LoadingState } from '@/components/ui/states'
import { useConnection } from '@/features/connection/connection-context'
import { OnboardingContainer } from '@/features/connection/OnboardingContainer'

export default function IndexRoute() {
  const { connection, isRestoring } = useConnection()
  if (isRestoring) {
    return <LoadingState />
  }
  if (connection) {
    return <Redirect href="/(tabs)/projects" />
  }
  return <OnboardingContainer />
}
