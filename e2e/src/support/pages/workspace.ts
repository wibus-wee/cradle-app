import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'

import { dismissTransientOverlays as dismissGlobalTransientOverlays } from '../overlays'
import { newChatWorkspaceSelector, visibleNewChatEntry } from '../ui'

const SIDEBAR_TIMEOUT = 15_000
const WORKSPACE_TIMEOUT = 10_000

const WORKSPACE_FIXTURES_KEY = 'workspace.fixtures'
const CURRENT_WORKSPACE_DIR_KEY = 'workspace.current-dir'

export interface WorkspaceFixture {
  dir: string
  name: string
  agentsHeading: string
  agentsBody: string
}

interface WorkspacePageOwner {
  page: Page
  params: {
    serverUrl: string
  }
  createTempWorkspaceDir: (prefix?: string) => string
  recall: <T>(key: string) => T
  remember: <T>(key: string, value: T) => void
  selectDirectoryInBrowser: (dirPath: string) => Promise<void>
}

interface ServerWorkspace {
  id: string
  name: string
  locator: { path: string }
}

export class WorkspacePage {
  constructor(private readonly owner: WorkspacePageOwner) {}

  private get page(): Page {
    return this.owner.page
  }

  async dismissTransientOverlays(): Promise<void> {
    await dismissGlobalTransientOverlays(this.page)
    const laterButton = this.page.getByRole('button', { name: /Later|稍后/i }).first()
    if (await laterButton.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await laterButton.click()
    }
    await this.page.keyboard.press('Escape').catch(() => undefined)
    await this.page.locator('[data-slot="dialog-overlay"][data-state="open"]')
      .waitFor({ state: 'hidden', timeout: 3_000 })
      .catch(() => undefined)
  }

  createFixture(prefix: string, label: string): WorkspaceFixture {
    const dir = this.owner.createTempWorkspaceDir(prefix)
    const name = basename(dir)
    const agentsHeading = `${label} Operating Model`
    const agentsBody = `${label} overview content used for end-to-end verification.`

    writeFileSync(join(dir, 'AGENTS.md'), `# ${agentsHeading}\n\n${agentsBody}\n`, 'utf8')

    return {
      dir,
      name,
      agentsHeading,
      agentsBody,
    }
  }

  rememberFixtures(fixtures: WorkspaceFixture[]): void {
    this.owner.remember(WORKSPACE_FIXTURES_KEY, fixtures)
  }

  recallFixtures(): WorkspaceFixture[] {
    return this.owner.recall<WorkspaceFixture[]>(WORKSPACE_FIXTURES_KEY)
  }

  setCurrentWorkspace(fixture: WorkspaceFixture): void {
    this.owner.remember(CURRENT_WORKSPACE_DIR_KEY, fixture.dir)
  }

  recallCurrentWorkspace(): WorkspaceFixture {
    const currentWorkspaceDir = this.owner.recall<string>(CURRENT_WORKSPACE_DIR_KEY)
    const fixture = this.recallFixtures().find(workspace => workspace.dir === currentWorkspaceDir)

    if (!fixture) {
      throw new Error(`Missing current workspace fixture for dir ${currentWorkspaceDir}`)
    }

    return fixture
  }

  recallWorkspaceByOrdinal(ordinal: number): WorkspaceFixture {
    const fixture = this.recallFixtures()[ordinal - 1]

    if (!fixture) {
      throw new Error(`Missing workspace fixture at ordinal ${ordinal}`)
    }

    return fixture
  }

  updateRememberedWorkspaceName(workspaceId: string, nextName: string): void {
    const fixtures = this.recallFixtures()
    const target = fixtures.find(fixture => fixture.dir === workspaceId)

    if (!target) {
      throw new Error(`Missing workspace fixture for rename: ${workspaceId}`)
    }

    target.name = nextName
    this.rememberFixtures(fixtures)
  }

  workspaceList(): Locator {
    return this.page.locator('[data-testid="workspace-list"]')
  }

  addWorkspaceButton(): Locator {
    return this.page.locator('[data-testid="add-workspace-btn"]')
  }

  addWorkspaceEmptyButton(): Locator {
    return this.page.locator('[data-testid="add-workspace-empty-btn"]')
  }

  workspaceGroups(): Locator {
    return this.page.locator('[data-testid^="workspace-group-"]')
  }

  workspaceButtonByName(name: string): Locator {
    return this.page.locator('[data-testid^="workspace-open-"]').filter({ hasText: name }).first()
  }

  activeDetailPage(): Locator {
    return this.page.locator('[data-testid="workspace-detail-page"]:visible').first()
  }

  detailTitleTrigger(): Locator {
    return this.activeDetailPage().locator('[data-testid="workspace-detail-title-trigger"]')
  }

  detailPath(): Locator {
    return this.activeDetailPage().locator('[data-testid="workspace-detail-path"]')
  }

  detailAgentsSection(): Locator {
    return this.activeDetailPage().locator('[data-testid="workspace-detail-agents-section"]')
  }

  async expectListEmpty(): Promise<void> {
    await expect(this.workspaceList()).toBeVisible({ timeout: SIDEBAR_TIMEOUT })
    await expect(this.addWorkspaceEmptyButton()).toBeVisible({ timeout: SIDEBAR_TIMEOUT })
  }

  async expectAddWorkspaceButtonVisible(): Promise<void> {
    const emptyBtn = this.addWorkspaceEmptyButton()
    const headerBtn = this.addWorkspaceButton()
    const emptyMenu = this.page.locator('[data-testid="add-workspace-empty-menu-btn"]')
    await expect.poll(async () => {
      return (await emptyBtn.isVisible().catch(() => false))
        || (await headerBtn.isVisible().catch(() => false))
        || (await emptyMenu.isVisible().catch(() => false))
    }, { timeout: SIDEBAR_TIMEOUT }).toBe(true)
  }

  async addWorkspaceFromPicker(fixture: WorkspaceFixture): Promise<void> {
    await this.dismissTransientOverlays()

    const beforeResponse = await fetch(`${this.owner.params.serverUrl}/workspaces`)
    if (!beforeResponse.ok) {
      throw new Error(`Failed to list workspaces before add: ${beforeResponse.status} ${await beforeResponse.text()}`)
    }
    const beforeWorkspaces = await beforeResponse.json() as ServerWorkspace[]

    const sidebar = this.page.locator('[data-testid="app-sidebar"]')
    await expect(sidebar).toBeVisible({ timeout: SIDEBAR_TIMEOUT })

    // Empty state uses add-workspace-empty-btn; non-empty uses header add-workspace-btn.
    // Prefer whichever is currently visible (and handle multi-workspace menu trigger).
    const emptyBtn = this.addWorkspaceEmptyButton()
    const headerBtn = this.addWorkspaceButton()
    const emptyMenu = this.page.locator('[data-testid="add-workspace-empty-menu-btn"]')
    const headerMenu = this.page.locator('[data-testid="add-workspace-menu-btn"]')

    if (await emptyBtn.isVisible().catch(() => false)) {
      await emptyBtn.click()
    }
    else if (await emptyMenu.isVisible().catch(() => false)) {
      await emptyMenu.click()
      await this.page.getByRole('menuitem', { name: /Add project|添加项目/i }).first().click()
    }
    else if (await headerBtn.isVisible().catch(() => false)) {
      await headerBtn.click()
    }
    else if (await headerMenu.isVisible().catch(() => false)) {
      await headerMenu.click()
      await this.page.getByRole('menuitem', { name: /Add project|添加项目/i }).first().click()
    }
    else {
      throw new Error('No add-workspace control found')
    }

    // New chrome: intermediate "Add workspace" host picker → Choose folder → directory browser.
    const chooseFolder = this.page.getByRole('button', { name: /Choose folder|选择文件夹|選擇資料夾/i })
    if (await chooseFolder.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await chooseFolder.click()
    }

    await this.owner.selectDirectoryInBrowser(fixture.dir)

    // Other setup steps may already have created workspaces. Wait for this exact
    // directory and assert that importing it adds one server record.
    await expect.poll(async () => {
      const response = await fetch(`${this.owner.params.serverUrl}/workspaces`)
      if (!response.ok) {
        return null
      }
      const workspaces = await response.json() as ServerWorkspace[]
      const match = workspaces.find(workspace => workspace.locator.path === fixture.dir)
      return match && workspaces.length === beforeWorkspaces.length + 1 ? match.id : null
    }, { timeout: WORKSPACE_TIMEOUT }).not.toBeNull()

    const afterResponse = await fetch(`${this.owner.params.serverUrl}/workspaces`)
    if (!afterResponse.ok) {
      throw new Error(`Failed to list workspaces after add: ${afterResponse.status} ${await afterResponse.text()}`)
    }
    const afterWorkspaces = await afterResponse.json() as ServerWorkspace[]
    const addedWorkspace = afterWorkspaces.find(workspace => workspace.locator.path === fixture.dir)
    if (!addedWorkspace) {
      throw new Error(`Workspace import completed without the requested path: ${fixture.dir}`)
    }
    if (addedWorkspace.name) {
      fixture.name = addedWorkspace.name
    }

    const rememberedFixtures = this.recallFixtures()
    const fixtureIndex = rememberedFixtures.findIndex(remembered => remembered.dir === fixture.dir)
    if (fixtureIndex >= 0) {
      rememberedFixtures[fixtureIndex] = fixture
    }
    else {
      rememberedFixtures.push(fixture)
    }
    this.rememberFixtures(rememberedFixtures)
    this.setCurrentWorkspace(fixture)

    await expect(this.workspaceGroups()).toHaveCount(afterWorkspaces.length, { timeout: WORKSPACE_TIMEOUT })
    await expect(this.workspaceButtonByName(fixture.name)).toBeVisible({ timeout: WORKSPACE_TIMEOUT })
  }

  async addWorkspaceThroughNativeDialog(): Promise<void> {
    const dir = this.owner.createTempWorkspaceDir()
    const fixture: WorkspaceFixture = {
      dir,
      name: basename(dir),
      agentsHeading: 'Added Workspace Operating Model',
      agentsBody: 'Added workspace overview content used for end-to-end verification.',
    }

    this.rememberFixtures([fixture])
    await this.addWorkspaceFromPicker(fixture)
    this.setCurrentWorkspace(fixture)
  }

  async expectWorkspaceListCount(count: number): Promise<void> {
    await expect(this.workspaceGroups()).toHaveCount(count, { timeout: WORKSPACE_TIMEOUT })
  }

  async ensureOneWorkspaceAdded(): Promise<void> {
    await this.dismissTransientOverlays()

    const listRes = await fetch(`${this.owner.params.serverUrl}/workspaces`)
    if (listRes.ok) {
      const workspaces = await listRes.json() as ServerWorkspace[]
      if (workspaces.length > 0) {
        const first = workspaces[0]!
        const fixture: WorkspaceFixture = {
          dir: first.locator.path,
          name: first.name,
          agentsHeading: 'Single Workspace Operating Model',
          agentsBody: 'Single workspace overview content used for end-to-end verification.',
        }
        this.rememberFixtures([fixture])
        this.setCurrentWorkspace(fixture)
        return
      }
    }

    const dir = this.owner.createTempWorkspaceDir()
    const fixture: WorkspaceFixture = {
      dir,
      name: basename(dir),
      agentsHeading: 'Single Workspace Operating Model',
      agentsBody: 'Single workspace overview content used for end-to-end verification.',
    }

    this.rememberFixtures([fixture])
    await this.addWorkspaceFromPicker(fixture)
    this.setCurrentWorkspace(fixture)
  }

  async openCurrentWorkspaceMenu(): Promise<void> {
    const group = this.workspaceGroups().first()
    await expect(group).toBeVisible({ timeout: WORKSPACE_TIMEOUT })
    await group.hover()

    const menuTrigger = group.locator('[data-slot="menu-trigger"]')
    await expect(menuTrigger).toBeVisible({ timeout: WORKSPACE_TIMEOUT })
    await menuTrigger.click()
    await expect(this.page.locator('[data-slot="menu-popup"]')).toBeVisible({ timeout: WORKSPACE_TIMEOUT })
  }

  async removeWorkspaceFromMenu(): Promise<void> {
    const removeItem = this.page.locator('[data-slot="menu-item"][data-variant="destructive"]')
    await expect(removeItem).toBeVisible({ timeout: WORKSPACE_TIMEOUT })
    await removeItem.click()
  }

  async addWorkspaceViaApi(fixture: WorkspaceFixture): Promise<void> {
    const res = await fetch(`${this.owner.params.serverUrl}/workspaces/from-directory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: fixture.dir }),
    })
    if (!res.ok) {
      throw new Error(`Failed to create workspace via API: ${res.status} ${await res.text()}`)
    }
  }

  async addApiWorkspace(): Promise<void> {
    const dir = this.owner.createTempWorkspaceDir()
    writeFileSync(join(dir, 'AGENTS.md'), '# API Workspace\n\nAPI-created workspace overview.\n', 'utf8')
    const fixture: WorkspaceFixture = {
      dir,
      name: basename(dir),
      agentsHeading: 'API Workspace',
      agentsBody: 'API-created workspace overview.',
    }

    await this.addWorkspaceViaApi(fixture)
    this.rememberFixtures([fixture])
    this.setCurrentWorkspace(fixture)
    await this.page.reload({ waitUntil: 'domcontentloaded' })
  }

  async addWorkspaceWithAgentsFromPicker(): Promise<void> {
    const fixture = this.createFixture('cradle-e2e-detail-', 'Workspace Detail')

    this.rememberFixtures([fixture])
    await this.addWorkspaceFromPicker(fixture)
    this.setCurrentWorkspace(fixture)
  }

  writeFileInCurrentWorkspace(relativePath: string, content: string): void {
    const fixture = this.recallCurrentWorkspace()
    const filePath = join(fixture.dir, relativePath)

    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, content, 'utf8')
  }

  async selectCurrentWorkspaceInNewChat(): Promise<void> {
    const fixture = this.recallCurrentWorkspace()
    const selector = newChatWorkspaceSelector(visibleNewChatEntry(this.owner))

    await expect(selector).toBeVisible({ timeout: WORKSPACE_TIMEOUT })
    await selector.click()

    const option = this.page.locator('[data-testid^="new-chat-workspace-option-"]').filter({ hasText: fixture.name }).first()
    await expect(option).toBeVisible({ timeout: WORKSPACE_TIMEOUT })
    await option.click()
    await expect(selector).toContainText(fixture.name, { timeout: WORKSPACE_TIMEOUT })
  }

  async addDistinguishableWorkspacesViaApi(): Promise<void> {
    const fixtures = [
      this.createFixture('cradle-e2e-a-', 'Workspace A'),
      this.createFixture('cradle-e2e-b-', 'Workspace B'),
    ]
    for (const fixture of fixtures) {
      await this.addWorkspaceViaApi(fixture)
    }
    this.rememberFixtures(fixtures)
    this.setCurrentWorkspace(fixtures[0]!)
    await this.page.reload({ waitUntil: 'domcontentloaded' })
  }

  async addDistinguishableWorkspacesFromPicker(): Promise<void> {
    const fixtures = [
      this.createFixture('cradle-e2e-alpha-', 'Alpha Workspace'),
      this.createFixture('cradle-e2e-beta-', 'Beta Workspace'),
    ]

    this.rememberFixtures(fixtures)

    for (const fixture of fixtures) {
      await this.addWorkspaceFromPicker(fixture)
    }
  }

  async openWorkspaceDetail(fixture: WorkspaceFixture): Promise<void> {
    const button = this.workspaceButtonByName(fixture.name)
    await expect(button).toBeVisible({ timeout: WORKSPACE_TIMEOUT })
    await button.click()

    const detailPage = this.activeDetailPage()
    await expect(detailPage).toBeVisible({ timeout: WORKSPACE_TIMEOUT })
    await expect(detailPage.locator('[data-testid="workspace-detail-path"]')).toHaveText(fixture.dir, { timeout: WORKSPACE_TIMEOUT })

    this.setCurrentWorkspace(fixture)
  }

  async openCurrentWorkspaceDetail(): Promise<void> {
    await this.openWorkspaceDetail(this.recallCurrentWorkspace())
  }

  async openWorkspaceDetailByOrdinal(ordinal: number): Promise<void> {
    await this.openWorkspaceDetail(this.recallWorkspaceByOrdinal(ordinal))
  }

  async renameCurrentWorkspace(nextName: string): Promise<void> {
    const fixture = this.recallCurrentWorkspace()
    const detailPage = this.activeDetailPage()

    await detailPage.locator('[data-testid="workspace-detail-title-trigger"]').click()

    const titleInput = detailPage.locator('[data-testid="workspace-detail-title-input"]')
    await expect(titleInput).toBeVisible({ timeout: WORKSPACE_TIMEOUT })
    await titleInput.fill(nextName)
    await titleInput.press('Enter')

    await expect.poll(async () => {
      const text = await detailPage.locator('[data-testid="workspace-detail-title-trigger"]').textContent().catch(() => '')
      return text?.includes(nextName) ? true : text
    }, { timeout: 20_000, message: `Expected title to contain "${nextName}"` }).toBe(true)

    this.updateRememberedWorkspaceName(fixture.dir, nextName)
  }

  async fillDetailTask(text: string): Promise<void> {
    const textarea = this.activeDetailPage().locator('[data-testid="workspace-detail-capsule-textarea"]')
    await expect(textarea).toBeVisible({ timeout: WORKSPACE_TIMEOUT })
    await textarea.fill(text)
  }

  async sendDetailTask(): Promise<void> {
    const button = this.activeDetailPage().locator('[data-testid="workspace-detail-capsule-send-btn"]')
    await expect(button).toBeEnabled({ timeout: WORKSPACE_TIMEOUT })
    await button.click()
  }

  async expectDetailTitle(expectedName: string): Promise<void> {
    await expect(this.detailTitleTrigger()).toContainText(expectedName, { timeout: WORKSPACE_TIMEOUT })
  }

  async expectCurrentDetailOpen(): Promise<void> {
    const fixture = this.recallCurrentWorkspace()

    await expect(this.activeDetailPage()).toBeVisible({ timeout: WORKSPACE_TIMEOUT })
    await expect(this.detailPath()).toHaveText(fixture.dir, { timeout: WORKSPACE_TIMEOUT })
  }

  async expectWorkspaceListContains(workspaceName: string): Promise<void> {
    await expect(this.page.locator('[data-testid^="workspace-open-"]').filter({ hasText: workspaceName }))
      .toHaveCount(1, { timeout: WORKSPACE_TIMEOUT })
  }

  async expectRememberedWorkspacesVisible(count: number): Promise<void> {
    const fixtures = this.recallFixtures()

    expect(fixtures).toHaveLength(count)
    await expect(this.workspaceGroups()).toHaveCount(count, { timeout: WORKSPACE_TIMEOUT })

    for (const fixture of fixtures) {
      await expect(this.workspaceButtonByName(fixture.name)).toContainText(fixture.name, { timeout: WORKSPACE_TIMEOUT })
    }
  }

  async expectDetailContent(fixture: WorkspaceFixture): Promise<void> {
    const detailPage = this.activeDetailPage()
    const agentsSection = this.detailAgentsSection()

    await expect(detailPage.locator('[data-testid="workspace-detail-title-trigger"]')).toContainText(fixture.name, { timeout: WORKSPACE_TIMEOUT })
    await expect(detailPage.locator('[data-testid="workspace-detail-path"]')).toHaveText(fixture.dir, { timeout: WORKSPACE_TIMEOUT })
    await expect(agentsSection).toContainText('AGENTS.md', { timeout: WORKSPACE_TIMEOUT })
    await expect(agentsSection).toContainText(fixture.agentsHeading, { timeout: WORKSPACE_TIMEOUT })
    await expect(agentsSection).toContainText(fixture.agentsBody, { timeout: WORKSPACE_TIMEOUT })
  }

  async expectDetailContentForOrdinal(ordinal: number): Promise<void> {
    await this.expectDetailContent(this.recallWorkspaceByOrdinal(ordinal))
  }

  async expectDetailTabsVisible(): Promise<void> {
    const detailPage = this.activeDetailPage()

    await expect(detailPage.locator('[data-testid="workspace-detail-tab-overview"]')).toBeVisible({ timeout: WORKSPACE_TIMEOUT })
    await expect(detailPage.locator('[data-testid="workspace-detail-tab-workflow-rules"]')).toBeVisible({ timeout: WORKSPACE_TIMEOUT })
    await expect(detailPage.locator('[data-testid="workspace-detail-tab-skills"]')).toBeVisible({ timeout: WORKSPACE_TIMEOUT })
  }

  async expectCurrentDetailContent(): Promise<void> {
    await this.expectDetailContent(this.recallCurrentWorkspace())
  }

  async expectRecentSessionTitle(title: string): Promise<void> {
    const recentSession = this.activeDetailPage().locator('[data-testid^="workspace-detail-recent-session-"]').filter({ hasText: title })
    await expect(recentSession).toBeVisible({ timeout: WORKSPACE_TIMEOUT })
  }
}
