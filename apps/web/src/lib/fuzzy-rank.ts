import { Fzf } from 'fzf'

export type FuzzyRankFieldRole = 'primary' | 'path' | 'secondary'

export interface FuzzyRankField {
  value: string | null | undefined
  role?: FuzzyRankFieldRole
}

export interface RankedFuzzyItem<TItem> {
  item: TItem
  positions: Set<number>
  rankScore: number
  fuzzyScore: number
}

interface IndexedFuzzyItem<TItem> {
  item: TItem
  index: number
  fields: NormalizedFuzzyRankField[]
  searchText: string
}

interface NormalizedFuzzyRankField {
  value: string
  role: FuzzyRankFieldRole
}

interface RankFuzzyItemsOptions<TItem> {
  fields: (item: TItem) => FuzzyRankField[]
  searchText?: (item: TItem) => string
  limit?: number
}

const ROLE_OFFSETS: Record<FuzzyRankFieldRole, number> = {
  primary: 0,
  path: 8,
  secondary: 0,
}
const SECONDARY_FIELD_OFFSET = 6_000_000

const TIER_EXACT = 0
const TIER_BASENAME_EXACT = 1
const TIER_PREFIX = 2
const TIER_BASENAME_PREFIX = 3
const TIER_SEGMENT_PREFIX = 4
const TIER_SUBSTRING = 5
const TIER_FUZZY = 8
const TIER_DISTANCE = 1_000_000
const ROLE_DISTANCE = 20_000
const ORIGINAL_INDEX_DISTANCE = 0.0001
const SEGMENT_SPLIT_RE = /[\s/\\_.:()[\]{}-]+/

export function rankFuzzyItems<TItem>(
  items: readonly TItem[],
  query: string,
  options: RankFuzzyItemsOptions<TItem>,
): Array<RankedFuzzyItem<TItem>> {
  const limit = options.limit ?? items.length
  const trimmedQuery = query.trim()
  if (!trimmedQuery) {
    return items.slice(0, limit).map((item, index) => ({
      item,
      positions: new Set<number>(),
      rankScore: index,
      fuzzyScore: 0,
    }))
  }

  const indexedItems = items.map((item, index): IndexedFuzzyItem<TItem> => {
    const fields = normalizeFields(options.fields(item))
    return {
      item,
      index,
      fields,
      searchText: options.searchText?.(item) ?? fields.map(field => field.value).join(' '),
    }
  })

  return new Fzf(indexedItems, {
    selector: item => item.searchText,
  })
    .find(trimmedQuery)
    .map(result => ({
      item: result.item.item,
      positions: result.positions,
      rankScore: scoreIndexedItem(result.item, trimmedQuery, result.score),
      fuzzyScore: result.score,
    }))
    .sort((left, right) => {
      if (left.rankScore !== right.rankScore) {
        return left.rankScore - right.rankScore
      }
      if (left.fuzzyScore !== right.fuzzyScore) {
        return right.fuzzyScore - left.fuzzyScore
      }
      return 0
    })
    .slice(0, limit)
}

function normalizeFields(fields: FuzzyRankField[]): NormalizedFuzzyRankField[] {
  return fields
    .map(field => ({
      value: field.value?.trim() ?? '',
      role: field.role ?? 'secondary',
    }))
    .filter(field => field.value.length > 0)
}

function scoreIndexedItem<TItem>(item: IndexedFuzzyItem<TItem>, query: string, fuzzyScore: number): number {
  let best = Number.POSITIVE_INFINITY
  for (const field of item.fields) {
    const score = scoreField(field, query)
    if (score !== null && score < best) {
      best = score
    }
  }

  const semanticScore = Number.isFinite(best)
    ? best
    : TIER_FUZZY * TIER_DISTANCE - fuzzyScore
  return semanticScore + item.index * ORIGINAL_INDEX_DISTANCE
}

function scoreField(field: NormalizedFuzzyRankField, query: string): number | null {
  const value = normalizeRankText(field.value)
  const normalizedQuery = normalizeRankText(query)
  if (!value || !normalizedQuery) {
    return null
  }

  const roleOffset = ROLE_OFFSETS[field.role] * ROLE_DISTANCE
  const fieldOffset = field.role === 'secondary' ? SECONDARY_FIELD_OFFSET : 0
  const basename = field.role === 'path' ? readPathBasename(value) : ''

  if (value === normalizedQuery) {
    return fieldOffset + TIER_EXACT * TIER_DISTANCE + roleOffset
  }
  if (basename && basename === normalizedQuery) {
    return fieldOffset + TIER_BASENAME_EXACT * TIER_DISTANCE + roleOffset
  }
  if (value.startsWith(normalizedQuery)) {
    return fieldOffset + TIER_PREFIX * TIER_DISTANCE + roleOffset + value.length
  }
  if (basename && basename.startsWith(normalizedQuery)) {
    return fieldOffset + TIER_BASENAME_PREFIX * TIER_DISTANCE + roleOffset + basename.length
  }

  const segmentIndex = value
    .split(SEGMENT_SPLIT_RE)
    .filter(Boolean)
    .findIndex(segment => segment.startsWith(normalizedQuery))
  if (segmentIndex >= 0) {
    return fieldOffset + TIER_SEGMENT_PREFIX * TIER_DISTANCE + roleOffset + segmentIndex
  }

  const substringIndex = value.indexOf(normalizedQuery)
  if (substringIndex >= 0) {
    return fieldOffset + TIER_SUBSTRING * TIER_DISTANCE + roleOffset + substringIndex
  }

  return null
}

function normalizeRankText(value: string): string {
  return value.trim().toLowerCase()
}

function readPathBasename(value: string): string {
  const slashIndex = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'))
  return slashIndex >= 0 ? value.slice(slashIndex + 1) : value
}
