import type { TFunction } from 'i18next'

import type { MemoryEntry } from './use-chronicle'

type ChronicleTranslate = TFunction<'chronicle'>

export function formatChronicleMemoryType(
  t: ChronicleTranslate,
  type: MemoryEntry['type'],
): string {
  return type === '10min' ? t('memory.type.short') : t('memory.type.long')
}

export function getChronicleMemoryMatchLabel(
  t: ChronicleTranslate,
  entry: MemoryEntry,
): string {
  if (entry.matchKind === 'hybrid') {
    return t('memory.match.hybrid')
  }
  if (entry.matchKind === 'semantic') {
    return entry.semanticScore !== null && entry.semanticScore !== undefined
      ? t('memory.match.semanticScore', { score: entry.semanticScore.toFixed(2) })
      : t('memory.match.semantic')
  }
  return t('memory.match.keyword')
}
