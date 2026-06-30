import { createFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'

import { SettingsContent } from '~/features/settings/settings-content'
import { useSettingsOverlayStore } from '~/store/settings-overlay'

export const Route = createFileRoute('/settings/$section')({
  component: SettingsRoute,
})

function SettingsRoute() {
  const { section } = Route.useParams()
  const setSettingsSection = useSettingsOverlayStore(s => s.setSettingsSection)

  useEffect(() => {
    setSettingsSection(section)
  }, [section, setSettingsSection])

  return <SettingsContent section={section} />
}
