import type { LinkCardDisplay } from './link-card'

/**
 * Pure helpers for the link-card markdown persistence format — kept free of
 * Tiptap deps so the read-only comment render path (AssetMarkdown) doesn't
 * pull the editor runtime.
 */

export const LINK_CARD_TITLE_PREFIX = 'cradle:'

/** The markdown link title value persisted for each display mode. */
export function linkCardTitle(display: LinkCardDisplay): string {
  return `${LINK_CARD_TITLE_PREFIX}${display}`
}

/** Inverse of {@link linkCardTitle}; `null` for plain (no-title) links. */
export function parseLinkCardTitle(title: string | null | undefined): LinkCardDisplay | null {
  if (!title || !title.startsWith(LINK_CARD_TITLE_PREFIX)) {
    return null
  }
  const value = title.slice(LINK_CARD_TITLE_PREFIX.length)
  return value === 'compact' ? 'compact' : 'card'
}
