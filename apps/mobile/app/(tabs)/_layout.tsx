import { useQueryClient } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { useContext } from 'react'

import { useConnection } from '@/features/connection/connection-context'
import { AppActiveContext } from '@/lib/app-lifecycle-context'
import { useSessionSummaryEvents } from '@/lib/use-session-summary-events'

export default function TabsLayout() {
  const { connection } = useConnection()
  const isAppActive = useContext(AppActiveContext)
  const queryClient = useQueryClient()
  useSessionSummaryEvents(connection, isAppActive, () => {
    void queryClient.invalidateQueries({ queryKey: ['projects', connection?.url] })
    void queryClient.invalidateQueries({ queryKey: ['workspace', connection?.url] })
    void queryClient.invalidateQueries({ queryKey: ['works', connection?.url] })
  })

  return <Stack screenOptions={{ freezeOnBlur: true, headerShown: false }} />
}
