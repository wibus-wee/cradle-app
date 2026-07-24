import type { TFunction } from 'i18next'

import type { ChronicleKnowledgeCard } from './use-chronicle'

type ChronicleTranslate = TFunction<'chronicle'>

export function formatChronicleKnowledgeCardType(
  t: ChronicleTranslate,
  type: ChronicleKnowledgeCard['cardType'],
): string {
  if (type === 'insight') { return t('knowledgeCard.type.insight') }
  if (type === 'decision') { return t('knowledgeCard.type.decision') }
  if (type === 'task') { return t('knowledgeCard.type.task') }
  if (type === 'pattern') { return t('knowledgeCard.type.pattern') }
  return t('knowledgeCard.type.fact')
}

export function formatChronicleKnowledgeDimension(
  t: ChronicleTranslate,
  dimension: ChronicleKnowledgeCard['dimension'],
): string {
  if (dimension === 'technical') { return t('knowledgeCard.dimension.technical') }
  if (dimension === 'business') { return t('knowledgeCard.dimension.business') }
  if (dimension === 'personal') { return t('knowledgeCard.dimension.personal') }
  if (dimension === 'project') { return t('knowledgeCard.dimension.project') }
  return t('knowledgeCard.dimension.general')
}

export function formatChronicleKnowledgeCardStatus(
  t: ChronicleTranslate,
  status: ChronicleKnowledgeCard['status'],
): string {
  if (status === 'active') { return t('knowledgeCard.status.active') }
  if (status === 'merged') { return t('knowledgeCard.status.merged') }
  if (status === 'archived') { return t('knowledgeCard.status.archived') }
  if (status === 'deleted') { return t('knowledgeCard.status.deleted') }
  return status
}
