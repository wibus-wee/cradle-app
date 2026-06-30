import { NewChatEntryPoint } from '~/features/new-chat/new-chat-page'
import { useSurfaceActive } from '~/navigation/surface-activity-context'

export function HomeDashboard() {
  const active = useSurfaceActive()

  return (
    <NewChatEntryPoint
      active={active}
      dataTestId="home-dashboard"
      includeLayoutSlots={false}
      replaceCurrentSurfaceOnSubmit={false}
      testIdPrefix="home"
    />
  )
}
