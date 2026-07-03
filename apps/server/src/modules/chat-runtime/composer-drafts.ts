import { composerDrafts } from '@cradle/db'
import { eq } from 'drizzle-orm'

import { currentUnixSeconds } from '../../helpers/time'
import { db } from '../../infra'
import type { ChatContextPart } from './context-parts'

export interface ComposerDraftPayload {
  text: string
  contextParts: ChatContextPart[]
}

export interface ComposerDraftDto {
  surfaceId: string
  draft: ComposerDraftPayload | null
  revision: number
  updatedAt: number | null
  deletedAt: number | null
}

export function readComposerDraft(surfaceId: string): ComposerDraftDto {
  const row = db().select().from(composerDrafts).where(eq(composerDrafts.surfaceId, surfaceId)).get()
  if (!row) {
    return {
      surfaceId,
      draft: null,
      revision: 0,
      updatedAt: null,
      deletedAt: null,
    }
  }

  return toComposerDraftDto(row)
}

export function writeComposerDraft(input: {
  surfaceId: string
  draft: ComposerDraftPayload
}): ComposerDraftDto {
  const existing = db().select().from(composerDrafts).where(eq(composerDrafts.surfaceId, input.surfaceId)).get()
  const now = currentUnixSeconds()
  const revision = (existing?.revision ?? 0) + 1
  const draftJson = JSON.stringify(input.draft)

  db()
    .insert(composerDrafts)
    .values({
      surfaceId: input.surfaceId,
      draftJson,
      revision,
      deletedAt: null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: composerDrafts.surfaceId,
      set: {
        draftJson,
        revision,
        deletedAt: null,
        updatedAt: now,
      },
    })
    .run()

  return readComposerDraft(input.surfaceId)
}

export function deleteComposerDraft(surfaceId: string): ComposerDraftDto {
  const existing = db().select().from(composerDrafts).where(eq(composerDrafts.surfaceId, surfaceId)).get()
  const now = currentUnixSeconds()
  const revision = (existing?.revision ?? 0) + 1

  db()
    .insert(composerDrafts)
    .values({
      surfaceId,
      draftJson: existing?.draftJson ?? '{}',
      revision,
      deletedAt: now,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: composerDrafts.surfaceId,
      set: {
        revision,
        deletedAt: now,
        updatedAt: now,
      },
    })
    .run()

  return readComposerDraft(surfaceId)
}

function toComposerDraftDto(row: typeof composerDrafts.$inferSelect): ComposerDraftDto {
  return {
    surfaceId: row.surfaceId,
    draft: row.deletedAt === null ? JSON.parse(row.draftJson) as ComposerDraftPayload : null,
    revision: row.revision,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  }
}
