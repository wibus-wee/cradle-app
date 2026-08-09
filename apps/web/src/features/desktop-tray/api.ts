import { getDesktopAwaits } from '~/api-gen/sdk.gen'

import type { DesktopAwaitItem } from './types'

export async function readDesktopAwaits(): Promise<DesktopAwaitItem[]> {
  const { data } = await getDesktopAwaits({
    cache: 'no-store',
    throwOnError: true,
  })
  return data
}
