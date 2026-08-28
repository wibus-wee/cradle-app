import { openSettingsSection } from '~/navigation/navigation-commands'
import { useSettingsOverlayStore } from '~/store/settings-overlay'

/** Opens Agent Management with a runtime-aware create draft. */
export function useCreateAgentCrossLink() {
  const setAgentCreateIntent = useSettingsOverlayStore(state => state.setAgentCreateIntent)

  return (runtimeKind: string, acpAgentId?: string) => {
    setAgentCreateIntent({ runtimeKind, acpAgentId })
    openSettingsSection('agents', { replace: true })
  }
}
