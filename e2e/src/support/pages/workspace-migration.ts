import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

import type { WorkspaceFixture } from './workspace'

const TIMEOUT = 15_000

interface WorkspaceMigrationOwner {
  page: Page
  params: { serverUrl: string }
  workspacePage: {
    recallWorkspaceByOrdinal: (ordinal: number) => WorkspaceFixture
  }
}

interface ServerWorkspace {
  id: string
  name: string
  locator: { path: string }
}

export class WorkspaceMigrationPage {
  constructor(private readonly owner: WorkspaceMigrationOwner) {}

  private get page(): Page {
    return this.owner.page
  }

  private async workspaceByOrdinal(ordinal: number): Promise<ServerWorkspace> {
    const fixture = this.owner.workspacePage.recallWorkspaceByOrdinal(ordinal)
    const response = await fetch(`${this.owner.params.serverUrl}/workspaces`)
    expect(response.ok).toBe(true)
    const workspaces = await response.json() as ServerWorkspace[]
    const workspace = workspaces.find(candidate => candidate.locator.path === fixture.dir)
    if (!workspace) {
      throw new Error(`Workspace fixture was not returned by the server: ${fixture.dir}`)
    }
    return workspace
  }

  private async postJson(path: string, body: object): Promise<unknown> {
    const response = await fetch(`${this.owner.params.serverUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      throw new Error(`POST ${path} failed: ${response.status} ${await response.text()}`)
    }
    return response.json()
  }

  async seedSourceEntities(): Promise<void> {
    const source = await this.workspaceByOrdinal(1)
    await this.postJson('/kanban/boards', {
      workspaceId: source.id,
      name: '迁移验证看板',
    })
    await this.postJson('/issues', {
      workspaceId: source.id,
      title: '迁移验证 Issue',
      description: 'This issue must retain ownership through workspace migration.',
    })
    await this.postJson('/automations', {
      title: '迁移验证 Automation',
      description: 'Workspace ownership migration fixture',
      workspaceId: source.id,
      enabled: true,
      trigger: {
        type: 'rrule',
        rrule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0;BYSECOND=0',
        timezone: 'UTC',
        misfirePolicy: 'skip',
      },
      recipe: {
        kind: 'agent_task',
        prompt: 'Summarize migrated workspace state.',
        inputs: [],
        artifactRequests: [{ kind: 'markdown', name: 'migration-report.md' }],
        providerTargetId: 'workspace-migration-fixture',
        runtimeKind: 'codex',
        modelId: 'gpt-5.1-codex-mini',
      },
      createdByKind: 'user',
    })
    await this.page.reload({ waitUntil: 'domcontentloaded' })
  }

  async openFromSourceWorkspace(): Promise<void> {
    const source = await this.workspaceByOrdinal(1)
    const fixture = this.owner.workspacePage.recallWorkspaceByOrdinal(1)
    const group = this.page.locator('[data-testid^="workspace-group-"]').filter({ hasText: fixture.name }).first()
    await expect(group).toBeVisible({ timeout: TIMEOUT })
    await group.hover()
    await group.locator('[data-slot="menu-trigger"]').click()
    await this.page.locator(`[data-testid="workspace-migrate-${source.id}"]`).click()
    await expect(this.page.getByRole('dialog', { name: 'Migrate workspace' })).toBeVisible({ timeout: TIMEOUT })
  }

  async chooseTargetAndReachReview(): Promise<void> {
    const target = this.owner.workspacePage.recallWorkspaceByOrdinal(2)
    const dialog = this.page.getByRole('dialog', { name: 'Migrate workspace' })
    await dialog.getByRole('combobox').click()
    await this.page.getByRole('option', { name: new RegExp(target.name) }).click()
    await dialog.getByRole('button', { name: 'Next' }).click()
    await expect(dialog.getByText('Field mappings')).toBeVisible({ timeout: TIMEOUT })
    await dialog.getByRole('button', { name: 'Next' }).click()
    await expect(dialog.getByText('Review migration')).toBeVisible({ timeout: TIMEOUT })
  }

  async preview(): Promise<void> {
    const dialog = this.page.getByRole('dialog', { name: 'Migrate workspace' })
    await dialog.getByRole('button', { name: 'Run preview' }).click()
    await expect(dialog.getByRole('button', { name: 'Migrate now' })).toBeEnabled({ timeout: TIMEOUT })
  }

  async expectPreviewCounts(): Promise<void> {
    const dialog = this.page.getByRole('dialog', { name: 'Migrate workspace' })
    for (const label of ['Issues processed', 'Boards moved', 'Automations moved']) {
      const stat = dialog.getByText(label, { exact: true }).locator('..')
      await expect(stat).toContainText('1', { timeout: TIMEOUT })
    }
  }

  async migrate(): Promise<void> {
    const dialog = this.page.getByRole('dialog', { name: 'Migrate workspace' })
    await dialog.getByRole('button', { name: 'Migrate now' }).click()
    await expect(dialog).toBeHidden({ timeout: TIMEOUT })
    await expect(this.page.getByText('Migration complete')).toBeVisible({ timeout: TIMEOUT })
  }

  async expectIssueOwnedByTarget(): Promise<void> {
    const detail = this.page.locator('[data-testid="issue-detail-panel"]')
    await expect(detail.locator('[data-testid="issue-workspace-trigger"]')).toHaveText(
      this.owner.workspacePage.recallWorkspaceByOrdinal(2).name,
      { timeout: TIMEOUT },
    )
  }

  async openMigratedBoard(): Promise<void> {
    const board = this.page.locator('[data-testid="kanban-sidebar"] [data-testid^="kanban-board-"]')
      .filter({ hasText: '迁移验证看板' })
      .first()
    await expect(board).toBeVisible({ timeout: TIMEOUT })
    await board.click()
    await expect(this.page.locator('[data-testid="kanban-board"]:visible')).toBeVisible({ timeout: TIMEOUT })
  }

  async openAutomations(): Promise<void> {
    await this.page.locator('[data-testid="nav-automation"]').click()
    await expect(this.page.locator('[data-testid="automation-dashboard"]')).toBeVisible({ timeout: TIMEOUT })
  }

  async expectAutomationVisible(): Promise<void> {
    const dashboard = this.page.locator('[data-testid="automation-dashboard"]')
    const definition = dashboard.getByRole('button', { name: /迁移验证 Automation/ })
    await expect(definition).toBeVisible({ timeout: TIMEOUT })
    await definition.click()

    const detail = dashboard.locator('main')
    await expect(detail).toContainText('迁移验证 Automation', { timeout: TIMEOUT })
    await expect(detail).toContainText(this.owner.workspacePage.recallWorkspaceByOrdinal(2).name, { timeout: TIMEOUT })
  }
}
