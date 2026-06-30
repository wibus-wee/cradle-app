import { randomUUID } from 'node:crypto'

import type { KanbanBoard } from '@cradle/db'
import { kanbanBoards, workspaces } from '@cradle/db'
import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { AppError } from '../../errors/app-error'
import { currentUnixSeconds } from '../../helpers/time'
import { db } from '../../infra'

const CreateBoardInputSchema = z.object({
  workspaceId: z.string(),
  name: z.string(),
  filterConfig: z.string().nullable().default(null),
})

function workspaceExists(workspaceId: string): boolean {
  return !!db().select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, workspaceId)).get()
}

function requireWorkspace(workspaceId: string): void {
  if (!workspaceExists(workspaceId)) {
    throw new AppError({ code: 'kanban_workspace_not_found', status: 404, message: 'Workspace not found', details: { workspaceId } })
  }
}

export function listBoards(workspaceId?: string): KanbanBoard[] {
  if (workspaceId && !workspaceExists(workspaceId)) {
    throw new AppError({ code: 'kanban_workspace_not_found', status: 404, message: 'Workspace not found', details: { workspaceId } })
  }
  const query = db().select().from(kanbanBoards)
  if (!workspaceId) {
    return query.orderBy(desc(kanbanBoards.createdAt)).all()
  }
  return query.where(eq(kanbanBoards.workspaceId, workspaceId)).orderBy(desc(kanbanBoards.createdAt)).all()
}

export function createBoard(rawInput: { workspaceId: string, name: string, filterConfig?: string | null }): KanbanBoard {
  const input = CreateBoardInputSchema.parse(rawInput)
  requireWorkspace(input.workspaceId)
  const now = currentUnixSeconds()
  return db().insert(kanbanBoards).values({
    id: randomUUID(),
    workspaceId: input.workspaceId,
    name: input.name,
    filterConfig: input.filterConfig,
    createdAt: now,
    updatedAt: now,
  }).returning().get()
}

export function deleteBoard(id: string): void {
  if (!db().select().from(kanbanBoards).where(eq(kanbanBoards.id, id)).get()) {
    throw new AppError({ code: 'kanban_board_not_found', status: 404, message: 'Board not found', details: { boardId: id } })
  }
  db().delete(kanbanBoards).where(eq(kanbanBoards.id, id)).run()
}

export function updateBoard(id: string, patch: { name?: string, filterConfig?: string | null }): KanbanBoard {
  const updates: Record<string, unknown> = { updatedAt: currentUnixSeconds() }
  if (patch.name !== undefined) {
    updates.name = patch.name
  }
  if ('filterConfig' in patch) {
    updates.filterConfig = patch.filterConfig ?? null
  }
  db().update(kanbanBoards).set(updates).where(eq(kanbanBoards.id, id)).run()
  const board = db().select().from(kanbanBoards).where(eq(kanbanBoards.id, id)).get()
  if (!board) {
    throw new AppError({ code: 'kanban_board_not_found', status: 404, message: 'Board not found', details: { boardId: id } })
  }
  return board
}
