import type {
  GetSearchChronicleResponse,
  GetSearchThreadsResponse,
} from '~/api-gen/types.gen'

export type MatchRange = GetSearchThreadsResponse[number]['titleRanges'][number]
export type ThreadSearchHit = GetSearchThreadsResponse[number]
export type ChronicleSearchHit = GetSearchChronicleResponse[number]
