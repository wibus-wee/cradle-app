import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import { newChatWorkspaceSelector, visibleNewChatEntry } from '../support/ui'
import type { CradleWorld } from '../support/world'

interface WorkspaceFixture {
  dir: string
  name: string
  agentsHeading: string
  agentsBody: string
}

const WORKSPACE_FIXTURES_KEY = 'workspace.fixtures'
const CURRENT_WORKSPACE_DIR_KEY = 'workspace.current-dir'

function createWorkspaceFixture(world: CradleWorld, prefix: string, label: string): WorkspaceFixture {
  const dir = world.createTempWorkspaceDir(prefix)
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

function rememberWorkspaceFixtures(world: CradleWorld, fixtures: WorkspaceFixture[]): void {
  world.remember(WORKSPACE_FIXTURES_KEY, fixtures)
}

function recallWorkspaceFixtures(world: CradleWorld): WorkspaceFixture[] {
  return world.recall<WorkspaceFixture[]>(WORKSPACE_FIXTURES_KEY)
}

function setCurrentWorkspace(world: CradleWorld, fixture: WorkspaceFixture): void {
  world.remember(CURRENT_WORKSPACE_DIR_KEY, fixture.dir)
}

function recallCurrentWorkspace(world: CradleWorld): WorkspaceFixture {
  const currentWorkspaceDir = world.recall<string>(CURRENT_WORKSPACE_DIR_KEY)
  const fixture = recallWorkspaceFixtures(world).find(workspace => workspace.dir === currentWorkspaceDir)

  if (!fixture) {
    throw new Error(`Missing current workspace fixture for dir ${currentWorkspaceDir}`)
  }

  return fixture
}

function recallWorkspaceByOrdinal(world: CradleWorld, ordinal: number): WorkspaceFixture {
  const fixture = recallWorkspaceFixtures(world)[ordinal - 1]

  if (!fixture) {
    throw new Error(`Missing workspace fixture at ordinal ${ordinal}`)
  }

  return fixture
}

function updateRememberedWorkspaceName(world: CradleWorld, workspaceId: string, nextName: string): void {
  const fixtures = recallWorkspaceFixtures(world)
  const target = fixtures.find(fixture => fixture.dir === workspaceId)

  if (!target) {
    throw new Error(`Missing workspace fixture for rename: ${workspaceId}`)
  }

  target.name = nextName
  rememberWorkspaceFixtures(world, fixtures)
}

function workspaceButtonByName(world: CradleWorld, name: string) {
  return world.page.locator('[data-testid^="workspace-open-"]').filter({ hasText: name }).first()
}

async function addWorkspaceFromPicker(world: CradleWorld, fixture: WorkspaceFixture): Promise<void> {
  // Ensure the sidebar workspace section is visible and scrolled to the add button
  const sidebar = world.page.locator('[data-testid="app-sidebar"]')
  await expect(sidebar).toBeVisible({ timeout: 15_000 })

  const button = world.page.locator('[data-testid="add-workspace-btn"]')
  // Wait for the button to be attached to DOM, then scroll into view
  await button.waitFor({ state: 'attached', timeout: 15_000 })
  await button.scrollIntoViewIfNeeded()
  await expect(button).toBeVisible({ timeout: 10_000 })
  await button.click()

  await world.selectDirectoryInBrowser(fixture.dir)

  await expect(workspaceButtonByName(world, fixture.name)).toContainText(fixture.name, { timeout: 10_000 })
}

function activeWorkspaceDetailPage(world: CradleWorld) {
  return world.page.locator('[data-testid="workspace-detail-page"]:visible').first()
}

async function openWorkspaceDetail(world: CradleWorld, fixture: WorkspaceFixture): Promise<void> {
  const button = workspaceButtonByName(world, fixture.name)
  await expect(button).toBeVisible({ timeout: 10_000 })
  await button.click()

  const detailPage = activeWorkspaceDetailPage(world)
  await expect(detailPage).toBeVisible({ timeout: 10_000 })
  await expect(detailPage.locator('[data-testid="workspace-detail-path"]')).toHaveText(fixture.dir, { timeout: 10_000 })

  setCurrentWorkspace(world, fixture)
}

async function assertWorkspaceDetailContent(world: CradleWorld, fixture: WorkspaceFixture): Promise<void> {
  const detailPage = activeWorkspaceDetailPage(world)
  const agentsSection = detailPage.locator('[data-testid="workspace-detail-agents-section"]')

  await expect(detailPage.locator('[data-testid="workspace-detail-title-trigger"]')).toContainText(fixture.name, { timeout: 10_000 })
  await expect(detailPage.locator('[data-testid="workspace-detail-path"]')).toHaveText(fixture.dir, { timeout: 10_000 })
  await expect(agentsSection).toContainText('AGENTS.md', { timeout: 10_000 })
  await expect(agentsSection).toContainText(fixture.agentsHeading, { timeout: 10_000 })
  await expect(agentsSection).toContainText(fixture.agentsBody, { timeout: 10_000 })
}

Then('我应该看到工作区列表为空', async function (this: CradleWorld) {
  console.warn('[step] assert workspace list is empty')
  await expect(this.page.locator('[data-testid="workspace-list"]')).toBeVisible({ timeout: 15_000 })
  await expect(this.page.locator('[data-testid="add-workspace-empty-btn"]')).toBeVisible({ timeout: 15_000 })
})

Then('我应该看到"添加工作区"按钮', async function (this: CradleWorld) {
  await expect(this.page.locator('[data-testid="add-workspace-btn"]')).toBeVisible({ timeout: 15_000 })
})

When('我通过原生对话框添加工作区', async function (this: CradleWorld) {
  const dir = this.createTempWorkspaceDir()
  const fixture = {
    dir,
    name: basename(dir),
    agentsHeading: 'Added Workspace Operating Model',
    agentsBody: 'Added workspace overview content used for end-to-end verification.',
  }

  rememberWorkspaceFixtures(this, [fixture])
  await addWorkspaceFromPicker(this, fixture)
  setCurrentWorkspace(this, fixture)
})

Then('工作区列表中应该有 {int} 个工作区', async function (this: CradleWorld, count: number) {
  await expect(this.page.locator('[data-testid^="workspace-group-"]')).toHaveCount(count, { timeout: 10_000 })
})

Given('我已添加了一个工作区', async function (this: CradleWorld) {
  console.warn('[step] setup: add one workspace')

  const dir = this.createTempWorkspaceDir()
  const fixture = {
    dir,
    name: basename(dir),
    agentsHeading: 'Single Workspace Operating Model',
    agentsBody: 'Single workspace overview content used for end-to-end verification.',
  }

  rememberWorkspaceFixtures(this, [fixture])
  await addWorkspaceFromPicker(this, fixture)
  setCurrentWorkspace(this, fixture)
})

When('我打开该工作区的菜单', async function (this: CradleWorld) {
  const group = this.page.locator('[data-testid^="workspace-group-"]').first()
  await expect(group).toBeVisible({ timeout: 10_000 })
  await group.hover()

  const menuTrigger = group.locator('[data-slot="menu-trigger"]')
  await expect(menuTrigger).toBeVisible({ timeout: 10_000 })
  await menuTrigger.click()
  await expect(this.page.locator('[data-slot="menu-popup"]')).toBeVisible({ timeout: 10_000 })
})

When('我点击"移除工作区"', async function (this: CradleWorld) {
  const removeItem = this.page.locator('[data-slot="menu-item"][data-variant="destructive"]')
  await expect(removeItem).toBeVisible({ timeout: 10_000 })
  await removeItem.click()
})

Given('我已添加了一个包含 AGENTS.md 的工作区', async function (this: CradleWorld) {
  const fixture = createWorkspaceFixture(this, 'cradle-e2e-detail-', 'Workspace Detail')

  rememberWorkspaceFixtures(this, [fixture])
  await addWorkspaceFromPicker(this, fixture)
  setCurrentWorkspace(this, fixture)
})

Given('当前工作区中存在文件{string}，内容为{string}', async function (this: CradleWorld, relativePath: string, content: string) {
  const fixture = recallCurrentWorkspace(this)
  const filePath = join(fixture.dir, relativePath)

  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, content, 'utf8')
})

When('我在新建聊天中选择当前工作区', async function (this: CradleWorld) {
  const fixture = recallCurrentWorkspace(this)
  const selector = newChatWorkspaceSelector(visibleNewChatEntry(this))

  await expect(selector).toBeVisible({ timeout: 10_000 })
  await selector.click()

  const option = this.page.locator('[data-testid^="new-chat-workspace-option-"]').filter({ hasText: fixture.name }).first()
  await expect(option).toBeVisible({ timeout: 10_000 })
  await option.click()
  await expect(selector).toContainText(fixture.name, { timeout: 10_000 })
})

Given('我已添加了两个可区分的工作区', async function (this: CradleWorld) {
  const fixtures = [
    createWorkspaceFixture(this, 'cradle-e2e-alpha-', 'Alpha Workspace'),
    createWorkspaceFixture(this, 'cradle-e2e-beta-', 'Beta Workspace'),
  ]

  rememberWorkspaceFixtures(this, fixtures)

  for (const fixture of fixtures) {
    await addWorkspaceFromPicker(this, fixture)
  }
})

When('我打开当前工作区的详情页', async function (this: CradleWorld) {
  await openWorkspaceDetail(this, recallCurrentWorkspace(this))
})

When('我打开第 {int} 个工作区的详情页', async function (this: CradleWorld, ordinal: number) {
  await openWorkspaceDetail(this, recallWorkspaceByOrdinal(this, ordinal))
})

When('我将工作区重命名为 {string}', async function (this: CradleWorld, nextName: string) {
  const fixture = recallCurrentWorkspace(this)
  const detailPage = activeWorkspaceDetailPage(this)

  await detailPage.locator('[data-testid="workspace-detail-title-trigger"]').click()

  const titleInput = detailPage.locator('[data-testid="workspace-detail-title-input"]')
  await expect(titleInput).toBeVisible({ timeout: 10_000 })
  await titleInput.fill(nextName)
  await titleInput.press('Enter')

  // Wait for the rename mutation to complete and the query to refetch
  await expect.poll(async () => {
    const text = await detailPage.locator('[data-testid="workspace-detail-title-trigger"]').textContent().catch(() => '')
    return text?.includes(nextName) ? true : text
  }, { timeout: 20_000, message: `Expected title to contain "${nextName}"` }).toBe(true)

  updateRememberedWorkspaceName(this, fixture.dir, nextName)
})

When('我在工作区详情页输入任务{string}', async function (this: CradleWorld, text: string) {
  const textarea = activeWorkspaceDetailPage(this).locator('[data-testid="workspace-detail-capsule-textarea"]')
  await expect(textarea).toBeVisible({ timeout: 10_000 })
  await textarea.fill(text)
})

When('我从工作区详情页发送任务', async function (this: CradleWorld) {
  const button = activeWorkspaceDetailPage(this).locator('[data-testid="workspace-detail-capsule-send-btn"]')
  await expect(button).toBeEnabled({ timeout: 10_000 })
  await button.click()
})

Then('工作区详情页标题应该是 {string}', async function (this: CradleWorld, expectedName: string) {
  await expect(activeWorkspaceDetailPage(this).locator('[data-testid="workspace-detail-title-trigger"]')).toContainText(expectedName, { timeout: 10_000 })
})

Then('当前工作区详情页应该打开', async function (this: CradleWorld) {
  const fixture = recallCurrentWorkspace(this)

  await expect(activeWorkspaceDetailPage(this)).toBeVisible({ timeout: 10_000 })
  await expect(activeWorkspaceDetailPage(this).locator('[data-testid="workspace-detail-path"]')).toHaveText(fixture.dir, { timeout: 10_000 })
})

Then('工作区列表中应该包含工作区 {string}', async function (this: CradleWorld, workspaceName: string) {
  await expect(this.page.locator('[data-testid^="workspace-open-"]').filter({ hasText: workspaceName })).toHaveCount(1, { timeout: 10_000 })
})

Then('工作区列表中应该包含这 {int} 个工作区', async function (this: CradleWorld, count: number) {
  const fixtures = recallWorkspaceFixtures(this)

  expect(fixtures).toHaveLength(count)
  await expect(this.page.locator('[data-testid^="workspace-group-"]')).toHaveCount(count, { timeout: 10_000 })

  for (const fixture of fixtures) {
    await expect(workspaceButtonByName(this, fixture.name)).toContainText(fixture.name, { timeout: 10_000 })
  }
})

Then('工作区详情页应该显示第 {int} 个工作区的真实内容', async function (this: CradleWorld, ordinal: number) {
  await assertWorkspaceDetailContent(this, recallWorkspaceByOrdinal(this, ordinal))
})

Then('我应该看到工作区详情页的标签页', async function (this: CradleWorld) {
  const detailPage = activeWorkspaceDetailPage(this)

  await expect(detailPage.locator('[data-testid="workspace-detail-tab-overview"]')).toBeVisible({ timeout: 10_000 })
  await expect(detailPage.locator('[data-testid="workspace-detail-tab-workflow-rules"]')).toBeVisible({ timeout: 10_000 })
  await expect(detailPage.locator('[data-testid="workspace-detail-tab-skills"]')).toBeVisible({ timeout: 10_000 })
})

Then('Overview 应该显示当前工作区的 AGENTS.md 内容', async function (this: CradleWorld) {
  await assertWorkspaceDetailContent(this, recallCurrentWorkspace(this))
})

Then('工作区详情页最近会话应显示{string}', async function (this: CradleWorld, title: string) {
  const recentSession = activeWorkspaceDetailPage(this).locator('[data-testid^="workspace-detail-recent-session-"]').filter({ hasText: title })
  await expect(recentSession).toBeVisible({ timeout: 10_000 })
})
