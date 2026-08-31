import { TopLevelTabPage } from '@/components/common/top-level-tab-page'
import { SettingsContainer } from '@/features/connection/SettingsContainer'

export default function SettingsRoute() {
  return (
    <TopLevelTabPage>
      <SettingsContainer />
    </TopLevelTabPage>
  )
}
