import { getServerUrl } from '~/lib/electron'

import type { DesktopAwaitItem } from './types'

async function requestDesktopJson(path: string): Promise<unknown> {
  const response = await fetch(`${getServerUrl()}${path}`, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`)
  }
  return response.json()
}

export async function readDesktopAwaits(): Promise<DesktopAwaitItem[]> {
  return await requestDesktopJson('/desktop/awaits') as DesktopAwaitItem[]
}
