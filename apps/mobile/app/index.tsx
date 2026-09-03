import { Redirect } from 'expo-router'

import { LoadingState } from '@/components/ui/states'
import { useConnection } from '@/features/connection/connection-context'
import { OnboardingContainer } from '@/features/connection/OnboardingContainer'
import { useFabric } from '@/features/fabric/fabric-context'

export default function IndexRoute() {
  const { connection, isRestoring } = useConnection()
  const fabric = useFabric()
  if (isRestoring || fabric.isRestoring) {
    return <LoadingState />
  }
  if (connection) {
    return <Redirect href="/(tabs)/projects" />
  }
  return <OnboardingContainer />
}
