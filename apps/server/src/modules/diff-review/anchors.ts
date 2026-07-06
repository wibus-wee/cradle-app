import type { DiffReviewFile, DiffReviewRevision } from '@cradle/db'
import { diffReviewRevisions } from '@cradle/db'
import { eq } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { db } from '../../infra'
import type { ParsedPatchLine } from './patch'
import { parsePatchLines } from './patch'
import type { ReviewRangeAnchorInput, ReviewRangeAnchorView } from './types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isRangeAnchor(value: unknown): value is ReviewRangeAnchorView {
  if (!isRecord(value)) {
    return false
  }
  const anchor = value as Partial<ReviewRangeAnchorView>
  return typeof anchor.revisionId === 'string'
    && typeof anchor.fileId === 'string'
    && typeof anchor.path === 'string'
    && (anchor.side === 'base' || anchor.side === 'head')
    && typeof anchor.startLine === 'number'
    && typeof anchor.endLine === 'number'
    && typeof anchor.hunkHeader === 'string'
    && typeof anchor.lineHash === 'string'
}

export function isRangeAnchorInput(value: unknown): value is ReviewRangeAnchorInput {
  if (!isRecord(value)) {
    return false
  }
  const anchor = value as Partial<ReviewRangeAnchorInput>
  return typeof anchor.fileId === 'string'
    && typeof anchor.startLine === 'number'
    && (anchor.side === undefined || anchor.side === 'base' || anchor.side === 'head')
}

export function toAnchorView(value: unknown): ReviewRangeAnchorView | null {
  return isRangeAnchor(value) ? value : null
}

export function normalizeAnchor(input: {
  revision: DiffReviewRevision
  file: DiffReviewFile
  anchor?: unknown
}): ReviewRangeAnchorView | null {
  if (!input.anchor) {
    return null
  }
  if (isRangeAnchor(input.anchor)) {
    return {
      ...input.anchor,
      revisionId: input.revision.id,
      fileId: input.file.id,
      path: input.file.path,
    }
  }
  if (!isRangeAnchorInput(input.anchor)) {
    return null
  }

  const side = input.anchor.side ?? 'head'
  const startLine = input.anchor.startLine
  const endLine = input.anchor.endLine ?? input.anchor.startLine
  const patchLines = parsePatchLines(input.revision.patch)
  const selected = patchLines.filter(line =>
    line.path === input.file.path
    && line.side === side
    && line.lineNumber >= startLine
    && line.lineNumber <= endLine)
  const primary = selected[0] ?? patchLines.find(line =>
    line.path === input.file.path
    && line.side === side
    && line.lineNumber === startLine)
  if (!primary) {
    throw new AppError({
      code: 'diff_review_anchor_not_found',
      status: 400,
      message: 'Diff review anchor line was not found in the current patch',
      details: { revisionId: input.revision.id, fileId: input.file.id, side, startLine, endLine },
    })
  }

  return {
    revisionId: input.revision.id,
    fileId: input.file.id,
    path: input.file.path,
    side,
    startLine,
    endLine,
    startColumn: input.anchor.startColumn,
    endColumn: input.anchor.endColumn,
    hunkHeader: primary.hunkHeader,
    lineHash: primary.lineHash,
    contextBeforeHash: primary.contextBeforeHash,
    contextAfterHash: selected.at(-1)?.contextAfterHash ?? primary.contextAfterHash,
  }
}

function normalizeFuzzyAnchorText(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, ' ')
}

function textSimilarity(left: string, right: string): number {
  const a = normalizeFuzzyAnchorText(left)
  const b = normalizeFuzzyAnchorText(right)
  if (!a || !b) {
    return 0
  }
  if (a === b) {
    return 1
  }
  if (a.includes(b) || b.includes(a)) {
    return Math.min(a.length, b.length) / Math.max(a.length, b.length)
  }

  const aTokens = new Set(a.split(/\W+/).filter(Boolean))
  const bTokens = new Set(b.split(/\W+/).filter(Boolean))
  if (aTokens.size === 0 || bTokens.size === 0) {
    return 0
  }
  let overlap = 0
  for (const token of aTokens) {
    if (bTokens.has(token)) {
      overlap++
    }
  }
  return (2 * overlap) / (aTokens.size + bTokens.size)
}

function findOriginalAnchorLine(anchor: ReviewRangeAnchorView, oldPath: string): ParsedPatchLine | undefined {
  const revision = db().select().from(diffReviewRevisions).where(eq(diffReviewRevisions.id, anchor.revisionId)).get()
  if (!revision) {
    return undefined
  }
  return parsePatchLines(revision.patch).find(line =>
    (line.path === oldPath || line.path === anchor.path)
    && line.side === anchor.side
    && line.lineHash === anchor.lineHash)
}

function findFuzzyAnchorLine(input: {
  anchor: ReviewRangeAnchorView
  candidates: ParsedPatchLine[]
  originalLine: ParsedPatchLine | undefined
}): ParsedPatchLine | undefined {
  const originalText = input.originalLine?.text
  if (!originalText || normalizeFuzzyAnchorText(originalText).length < 6) {
    return undefined
  }

  const ranked = input.candidates
    .map((candidate) => {
      const similarity = textSimilarity(originalText, candidate.text)
      const contextBonus = (
        candidate.contextBeforeHash === input.anchor.contextBeforeHash
        || candidate.contextAfterHash === input.anchor.contextAfterHash
      )
? 0.12
: 0
      const hunkBonus = candidate.hunkHeader === input.anchor.hunkHeader ? 0.08 : 0
      const lineDistance = Math.abs(candidate.lineNumber - input.anchor.startLine)
      const distancePenalty = Math.min(lineDistance, 30) / 100
      return {
        candidate,
        lineDistance,
        score: similarity + contextBonus + hunkBonus - distancePenalty,
        similarity,
      }
    })
    .filter(item => item.similarity >= 0.72 && item.lineDistance <= 30)
    .sort((left, right) => right.score - left.score)

  return ranked[0]?.candidate
}

export function remapAnchorToRevision(input: {
  anchor: ReviewRangeAnchorView
  oldFile: DiffReviewFile | undefined
  newRevision: DiffReviewRevision
  newFiles: DiffReviewFile[]
}): { anchor: ReviewRangeAnchorView, fileId: string } | null {
  const oldPath = input.oldFile?.path ?? input.anchor.path
  const newFile = input.newFiles.find(file =>
    file.path === oldPath
    || file.previousPath === oldPath
    || file.path === input.anchor.path
    || file.previousPath === input.anchor.path)
  if (!newFile) {
    return null
  }

  const patchLines = parsePatchLines(input.newRevision.patch)
  const candidates = patchLines.filter(line => line.path === newFile.path && line.side === input.anchor.side)
  const exact = candidates.find(line => line.lineHash === input.anchor.lineHash)
  const context = !exact
    ? candidates.find(line =>
      line.hunkHeader === input.anchor.hunkHeader
      && line.contextBeforeHash === input.anchor.contextBeforeHash
      && line.contextAfterHash === input.anchor.contextAfterHash)
    : undefined
  const fuzzy = !exact && !context
    ? findFuzzyAnchorLine({
        anchor: input.anchor,
        candidates,
        originalLine: findOriginalAnchorLine(input.anchor, oldPath),
      })
    : undefined
  const remapped = exact ?? context ?? fuzzy
  if (!remapped) {
    return null
  }

  const length = Math.max(0, input.anchor.endLine - input.anchor.startLine)
  return {
    fileId: newFile.id,
    anchor: {
      ...input.anchor,
      revisionId: input.newRevision.id,
      fileId: newFile.id,
      path: newFile.path,
      startLine: remapped.lineNumber,
      endLine: remapped.lineNumber + length,
      hunkHeader: remapped.hunkHeader,
      lineHash: remapped.lineHash,
      contextBeforeHash: remapped.contextBeforeHash,
      contextAfterHash: remapped.contextAfterHash,
    },
  }
}
