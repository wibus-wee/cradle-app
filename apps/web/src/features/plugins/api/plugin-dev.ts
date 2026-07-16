import { getPluginsDevSessions } from '~/api-gen/sdk.gen'

export async function readPluginDevSessions(): Promise<unknown> {
  const { data, error } = await getPluginsDevSessions()
  if (error) {
    throw new Error('Failed to read plugin development sessions.')
  }
  return data ?? []
}
