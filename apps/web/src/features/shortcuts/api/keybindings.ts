import { getPreferencesKeybindingsOptions } from '~/api-gen/@tanstack/react-query.gen'
import { getPreferencesKeybindings } from '~/api-gen/sdk.gen'

export const keybindingsQueryOptions = getPreferencesKeybindingsOptions

export async function readKeybindings() {
  const { data } = await getPreferencesKeybindings({ throwOnError: true })
  return data
}
