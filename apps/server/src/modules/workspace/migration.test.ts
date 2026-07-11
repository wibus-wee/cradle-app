import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { automationDefinitions, kanbanBoards, workspaces } from '@cradle/db'
import { describe, expect, it } from 'vitest'

import { workspaceFixture } from '../../../tests/helpers/workspace-fixture'
import { db, shutdownInfra } from '../../infra'
import { migrateWorkspace } from './service'

async function withMigrationDatabase(run: () => void | Promise<void>): Promise<void> {
  const dataDir = mkdtempSync(join(tmpdir(), 'cradle-workspace-migration-'))
  const sourceRoot = mkdtempSync(join(tmpdir(), 'cradle-workspace-source-'))
  const targetRoot = mkdtempSync(join(tmpdir(), 'cradle-workspace-target-'))
  const previousDataDir = process.env.CRADLE_DATA_DIR
  process.env.CRADLE_DATA_DIR = dataDir

  try {
    db().insert(workspaces).values([
      workspaceFixture({ id: 'source', name: 'Source', path: sourceRoot, identifier: 'SRC' }),
      workspaceFixture({ id: 'target', name: 'Target', path: targetRoot, identifier: 'TGT' }),
    ]).run()
    db().insert(kanbanBoards).values({
      id: 'board-1',
      workspaceId: 'source',
      name: 'Board',
    }).run()
    db().insert(automationDefinitions).values({
      id: 'automation-1',
      workspaceId: 'source',
      title: 'Automation',
      triggerJson: '{}',
      recipeJson: '{}',
    }).run()
    await run()
  }
  finally {
    shutdownInfra()
    rmSync(dataDir, { recursive: true, force: true })
    rmSync(sourceRoot, { recursive: true, force: true })
    rmSync(targetRoot, { recursive: true, force: true })
    if (previousDataDir === undefined) {
      delete process.env.CRADLE_DATA_DIR
    }
    else {
      process.env.CRADLE_DATA_DIR = previousDataDir
    }
  }
}

function readMigrationRows() {
  return {
    boards: db().select().from(kanbanBoards).all(),
    automations: db().select().from(automationDefinitions).all(),
  }
}

describe('workspace migration ownership', () => {
  it('keeps dry-run read-only and rolls back all apply phases on failure', async () => {
    await withMigrationDatabase(() => {
      const before = readMigrationRows()
      const preview = migrateWorkspace('source', 'target', {
        dryRun: true,
        entities: ['kanban', 'automation'],
      })

      expect(preview).toMatchObject({
        dryRun: true,
        kanban: { boardsMoved: 1 },
        automation: { definitionsMoved: 1 },
      })
      expect(readMigrationRows()).toEqual(before)

      expect(() => db().transaction(() => {
        migrateWorkspace('source', 'target', { entities: ['kanban', 'automation'] })
        throw new Error('forced failure after all migration writes')
      })).toThrow('forced failure')
      expect(readMigrationRows()).toEqual(before)

      expect(migrateWorkspace('source', 'target', {
        entities: ['kanban', 'automation'],
      })).toMatchObject({
        dryRun: false,
        kanban: { boardsMoved: 1 },
        automation: { definitionsMoved: 1 },
      })
      expect(readMigrationRows()).toMatchObject({
        boards: [expect.objectContaining({ workspaceId: 'target' })],
        automations: [expect.objectContaining({ workspaceId: 'target' })],
      })
    })
  })
})
