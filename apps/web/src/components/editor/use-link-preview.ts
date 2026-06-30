import { useQuery } from '@tanstack/react-query'

import { getLinkPreview } from '~/api-gen/sdk.gen'

export interface LinkPreviewData {
  url: string
  title: string | null
  description: string | null
  image: string | null
  siteName: string | null
  favicon: string | null
}

const HTTP_URL_PATTERN = /^https?:\/\//i

/**
 * Unfurls an http(s) URL into OpenGraph metadata for link-card rendering.
 * Cached for an hour server-side and treated as stale after an hour client-side
 * so a card never re-fetches on every render.
 */
export function useLinkPreview(href: string | null | undefined) {
  const url = href?.trim() || ''
  const enabled = HTTP_URL_PATTERN.test(url)
  return useQuery({
    queryKey: ['link-preview', url],
    queryFn: async () => {
      const { data } = await getLinkPreview({ query: { url } })
      return data as LinkPreviewData
    },
    enabled,
    staleTime: 1000 * 60 * 60,
    gcTime: 1000 * 60 * 60,
    retry: 1,
    refetchOnWindowFocus: false,
  })
}
