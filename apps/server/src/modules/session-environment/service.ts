import { randomUUID } from 'node:crypto'

import {
  messages,
  sessionEnvironmentNotes,
  sessionPinnedMessages,
  sessions,
  sessionTextMarkers,
} from '@cradle/db'
import { and, asc, eq, gt, lt, sql } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { currentUnixSeconds } from '../../helpers/time'
import { db } from '../../infra'
import * as Automation from '../automation/service'
import * as PullRequest from '../pull-request/service'
import * as ThreadHandoff from '../thread-handoff/service'
import * as TurnCheckpoint from '../turn-checkpoint/service'
import * as Usage from '../usage/service'

const MAX_NOTES_CHARS = 16_000
const MAX_PIN_COUNT = 50
const MAX_MARKER_COUNT = 100
const MAX_LABEL_CHARS = 120
const MAX_SELECTED_TEXT_CHARS = 2_000

export function getEnvironment(sessionId: string) {
  assertSessionExists(sessionId)
  const notes = db().select().from(sessionEnvironmentNotes).where(eq(sessionEnvironmentNotes.sessionId, sessionId)).get()
  return {
    sessionId,
    notes: notes?.notes ?? '',
    pins: listPins(sessionId),
    markers: listMarkers(sessionId),
    usage: Usage.getSessionUsage(sessionId),
    pullRequest: PullRequest.getBoundPullRequest(sessionId),
    automationRuns: Automation.listRunsForSession(sessionId).slice(0, 5),
    checkpoints: TurnCheckpoint.listForSession(sessionId).slice(0, 20),
    handoff: ThreadHandoff.getByDestinationSessionId(sessionId),
  }
}

export function setNotes(sessionId: string, notes: string) {
  assertSessionExists(sessionId)
  if (notes.length > MAX_NOTES_CHARS) {
    throwInvalid('Session notes are too long', { maxChars: MAX_NOTES_CHARS })
  }
  const now = currentUnixSeconds()
  db().insert(sessionEnvironmentNotes).values({ sessionId, notes, createdAt: now, updatedAt: now }).onConflictDoUpdate({
      target: sessionEnvironmentNotes.sessionId,
      set: { notes, updatedAt: now },
    }).run()
  return { sessionId, notes, updatedAt: now }
}

export function addPin(sessionId: string, messageId: string) {
  assertMessageInSession(sessionId, messageId)
  const count = db().select({ count: sql<number>`count(*)` }).from(sessionPinnedMessages).where(eq(sessionPinnedMessages.sessionId, sessionId)).get()?.count ?? 0
  const existing = db().select().from(sessionPinnedMessages).where(and(
    eq(sessionPinnedMessages.sessionId, sessionId),
    eq(sessionPinnedMessages.messageId, messageId),
  )).get()
  if (!existing && count >= MAX_PIN_COUNT) {
    throwInvalid('Pinned message limit reached', { maxCount: MAX_PIN_COUNT })
  }
  const now = currentUnixSeconds()
  db().insert(sessionPinnedMessages).values({
    sessionId,
    messageId,
    label: null,
    done: false,
    pinnedAt: now,
    updatedAt: now,
  }).onConflictDoNothing().run()
  return requirePin(sessionId, messageId)
}

export function updatePin(sessionId: string, messageId: string, patch: { label?: string | null, done?: boolean }) {
  requirePin(sessionId, messageId)
  const label = patch.label === undefined ? undefined : normalizeLabel(patch.label)
  db().update(sessionPinnedMessages).set({
    ...(label !== undefined ? { label } : {}),
    ...(patch.done !== undefined ? { done: patch.done } : {}),
    updatedAt: currentUnixSeconds(),
  }).where(and(
    eq(sessionPinnedMessages.sessionId, sessionId),
    eq(sessionPinnedMessages.messageId, messageId),
  )).run()
  return requirePin(sessionId, messageId)
}

export function removePin(sessionId: string, messageId: string): { ok: true } {
  db().delete(sessionPinnedMessages).where(and(
    eq(sessionPinnedMessages.sessionId, sessionId),
    eq(sessionPinnedMessages.messageId, messageId),
  )).run()
  return { ok: true }
}

export function addMarker(sessionId: string, input: {
  messageId: string
  startOffset: number
  endOffset: number
  selectedText: string
  style: 'highlight' | 'underline'
  color: 'yellow' | 'blue' | 'green' | 'pink'
}) {
  assertMessageInSession(sessionId, input.messageId)
  if (input.startOffset < 0 || input.endOffset <= input.startOffset) {
    throwInvalid('Marker range is invalid', input)
  }
  if (!input.selectedText.trim() || input.selectedText.length > MAX_SELECTED_TEXT_CHARS) {
    throwInvalid('Marker selected text is invalid', { maxChars: MAX_SELECTED_TEXT_CHARS })
  }
  return db().transaction((tx) => {
    tx.delete(sessionTextMarkers).where(and(
      eq(sessionTextMarkers.sessionId, sessionId),
      eq(sessionTextMarkers.messageId, input.messageId),
      lt(sessionTextMarkers.startOffset, input.endOffset),
      gt(sessionTextMarkers.endOffset, input.startOffset),
    )).run()
    const count = tx.select({ count: sql<number>`count(*)` }).from(sessionTextMarkers).where(eq(sessionTextMarkers.sessionId, sessionId)).get()?.count ?? 0
    if (count >= MAX_MARKER_COUNT) {
      throwInvalid('Text marker limit reached', { maxCount: MAX_MARKER_COUNT })
    }

    const now = currentUnixSeconds()
    return tx.insert(sessionTextMarkers).values({
      id: randomUUID(),
      sessionId,
      ...input,
      label: null,
      done: false,
      createdAt: now,
      updatedAt: now,
    }).returning().get()
  })
}

export function updateMarker(sessionId: string, markerId: string, patch: { label?: string | null, done?: boolean }) {
  requireMarker(sessionId, markerId)
  const label = patch.label === undefined ? undefined : normalizeLabel(patch.label)
  db().update(sessionTextMarkers).set({
    ...(label !== undefined ? { label } : {}),
    ...(patch.done !== undefined ? { done: patch.done } : {}),
    updatedAt: currentUnixSeconds(),
  }).where(and(eq(sessionTextMarkers.sessionId, sessionId), eq(sessionTextMarkers.id, markerId))).run()
  return requireMarker(sessionId, markerId)
}

export function removeMarker(sessionId: string, markerId: string): { ok: true } {
  db().delete(sessionTextMarkers).where(and(
    eq(sessionTextMarkers.sessionId, sessionId),
    eq(sessionTextMarkers.id, markerId),
  )).run()
  return { ok: true }
}

function listPins(sessionId: string) {
  return db().select().from(sessionPinnedMessages).where(eq(sessionPinnedMessages.sessionId, sessionId)).orderBy(asc(sessionPinnedMessages.pinnedAt)).all()
}

function listMarkers(sessionId: string) {
  return db().select().from(sessionTextMarkers).where(eq(sessionTextMarkers.sessionId, sessionId)).orderBy(asc(sessionTextMarkers.createdAt)).all()
}

function requirePin(sessionId: string, messageId: string) {
  const row = db().select().from(sessionPinnedMessages).where(and(
    eq(sessionPinnedMessages.sessionId, sessionId),
    eq(sessionPinnedMessages.messageId, messageId),
  )).get()
  if (!row) {
    throw new AppError({ code: 'session_pin_not_found', status: 404, message: 'Pinned message not found', details: { sessionId, messageId } })
  }
  return row
}

function requireMarker(sessionId: string, markerId: string) {
  const row = db().select().from(sessionTextMarkers).where(and(
    eq(sessionTextMarkers.sessionId, sessionId),
    eq(sessionTextMarkers.id, markerId),
  )).get()
  if (!row) {
    throw new AppError({ code: 'session_marker_not_found', status: 404, message: 'Text marker not found', details: { sessionId, markerId } })
  }
  return row
}

function assertSessionExists(sessionId: string): void {
  const row = db().select({ id: sessions.id }).from(sessions).where(eq(sessions.id, sessionId)).get()
  if (!row) {
    throw new AppError({ code: 'session_not_found', status: 404, message: 'Session not found', details: { sessionId } })
  }
}

function assertMessageInSession(sessionId: string, messageId: string): void {
  const row = db().select({ id: messages.id }).from(messages).where(and(
    eq(messages.id, messageId),
    eq(messages.sessionId, sessionId),
  )).get()
  if (!row) {
    throwInvalid('Message does not belong to this session', { sessionId, messageId })
  }
}

function normalizeLabel(label: string | null): string | null {
  if (label === null) {
    return null
  }
  const trimmed = label.trim()
  if (!trimmed) {
    return null
  }
  if (trimmed.length > MAX_LABEL_CHARS) {
    throwInvalid('Label is too long', { maxChars: MAX_LABEL_CHARS })
  }
  return trimmed
}

function throwInvalid(message: string, details: Record<string, unknown>): never {
  throw new AppError({ code: 'invalid_session_environment_input', status: 400, message, details })
}
