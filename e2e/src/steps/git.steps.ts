import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import {
  newChatWorkspaceSelector,
  visibleNewChatEntry,
} from '../support/ui'
import type { CradleWorld } from '../support/world'

interface GitWorkspaceFixture {
  dir: string
  name: string
  currentBranch: string
  seedBranch: string
  latestMainSubject: string
  seedSubject: string
}

const GIT_WORKSPACE_KEY = 'git.workspace-fixture'
const GIT_BRANCH_PICKER = '[data-testid="git-branch-picker"]'
const GIT_TARGET_BRANCH_KEY = 'git.target-branch'

function runGit(dir: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
  }).trim()
}

function initGitRepository(dir: string): void {
  try {
    runGit(dir, ['init', '--initial-branch=main'])
  }
  catch {
    runGit(dir, ['init'])
    runGit(dir, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
  }

  runGit(dir, ['config', 'user.name', 'Cradle E2E'])
  runGit(dir, ['config', 'user.email', 'cradle-e2e@example.com'])
  runGit(dir, ['config', 'commit.gpgSign', 'false'])
}

function commitFile(dir: string, fileName: string, content: string, message: string): void {
  writeFileSync(join(dir, fileName), `${content}\n`, 'utf8')
  runGit(dir, ['add', fileName])
  runGit(dir, ['commit', '-m', message])
}

function createGitWorkspaceFixture(world: CradleWorld): GitWorkspaceFixture {
  const dir = world.createTempWorkspaceDir('cradle-e2e-git-ws-')
  const name = basename(dir)
  const seedBranch = 'seed-branch'
  const latestMainSubject = 'main: third commit'
  const seedSubject = 'seed: branch commit'

  writeFileSync(
    join(dir, 'AGENTS.md'),
    '# Git E2E Fixture\n\nThis workspace is created by the Git end-to-end suite.\n',
    'utf8',
  )

  initGitRepository(dir)
  runGit(dir, ['add', 'AGENTS.md'])
  commitFile(dir, 'README.md', `# ${name}`, 'repo: initial commit')
  commitFile(dir, 'main.txt', 'main branch content', 'main: second commit')

  runGit(dir, ['checkout', '-b', seedBranch])
  commitFile(dir, 'seed.txt', 'seed branch content', seedSubject)

  runGit(dir, ['checkout', 'main'])
  commitFile(dir, 'notes.txt', 'third commit on main', latestMainSubject)

  return {
    dir,
    name,
    currentBranch: 'main',
    seedBranch,
    latestMainSubject,
    seedSubject,
  }
}

function recallGitWorkspace(world: CradleWorld): GitWorkspaceFixture {
  return world.recall<GitWorkspaceFixture>(GIT_WORKSPACE_KEY)
}

function updateCurrentBranch(world: CradleWorld, branchName: string): void {
  const fixture = recallGitWorkspace(world)
  fixture.currentBranch = branchName
  world.remember(GIT_WORKSPACE_KEY, fixture)
}

async function openRightAside(world: CradleWorld): Promise<void> {
  await world.gitPage.openRightAside()
}

async function switchRightAsideToGit(world: CradleWorld): Promise<void> {
  await world.gitPage.switchToGitTab()
}

Given('我已添加了一个真实 Git 工作区', async function (this: CradleWorld) {
  console.warn('[step] setup: add real git workspace via API')
  const fixture = createGitWorkspaceFixture(this)
  const response = await fetch(`${this.params.serverUrl}/workspaces/from-directory`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: fixture.dir }),
  })
  if (!response.ok) {
    throw new Error(`Failed to create git workspace: ${response.status} ${await response.text()}`)
  }
  this.remember(GIT_WORKSPACE_KEY, fixture)
  await this.page.reload({ waitUntil: 'domcontentloaded' })
  await expect(
    this.page.locator('[data-testid^="workspace-open-"]').filter({ hasText: fixture.name }).first(),
  ).toBeVisible({ timeout: 15_000 })
})

Given('我在新建聊天中选择 Git 工作区', async function (this: CradleWorld) {
  const fixture = recallGitWorkspace(this)
  const selector = newChatWorkspaceSelector(visibleNewChatEntry(this))

  await expect(selector).toBeVisible({ timeout: 10_000 })
  await selector.click()

  const option = this.page.locator('[data-testid^="new-chat-workspace-option-"]').filter({ hasText: fixture.name }).first()
  await expect(option).toBeVisible({ timeout: 10_000 })
  await option.click()
  await expect(selector).toContainText(fixture.name, { timeout: 10_000 })
})

Then('Chat Header 中应该显示当前 Git 分支', async function (this: CradleWorld) {
  const fixture = recallGitWorkspace(this)
  await this.gitPage.openRightAside()
  await this.gitPage.switchToGitTab()
  await this.gitPage.expectBranch(fixture.currentBranch)
})

Then('Chat Header 中应该显示 Git 分支 {string}', async function (this: CradleWorld, branchName: string) {
  await this.gitPage.openRightAside()
  await this.gitPage.switchToGitTab()
  await this.gitPage.expectBranch(branchName)
})

When('我打开 Chat Header 中的 Git 分支选择器', async function (this: CradleWorld) {
  console.warn('[step] open git branch picker from git panel')
  await this.gitPage.openRightAside()
  await this.gitPage.switchToGitTab()
  await this.gitPage.openBranchPicker()
})

Then('我应该看到 Git 分支选择器', async function (this: CradleWorld) {
  await expect(this.gitPage.picker()).toBeVisible({ timeout: 10_000 })
})

Then('Git 分支选择器中应该包含本地分支 {string}', async function (this: CradleWorld, branchName: string) {
  await this.gitPage.expectLocalBranchVisible(branchName)
})

When('我在分支选择器中开始创建新分支', async function (this: CradleWorld) {
  const button = this.page.locator('[data-testid="git-branch-start-create"]')
  await expect(button).toBeVisible({ timeout: 10_000 })
  await button.click()
  await expect(this.page.locator('[data-testid="git-branch-create-input"]')).toBeVisible({ timeout: 10_000 })
})

When('我在分支选择器中输入新分支名 {string}', async function (this: CradleWorld, branchName: string) {
  const input = this.page.locator('[data-testid="git-branch-create-input"]')
  await expect(input).toBeVisible({ timeout: 10_000 })
  await input.fill(branchName)
  this.remember(GIT_TARGET_BRANCH_KEY, branchName)
})

When('我确认创建并切换分支', async function (this: CradleWorld) {
  const targetBranch = this.recall<string>(GIT_TARGET_BRANCH_KEY)
  const button = this.page.locator('[data-testid="git-branch-create-submit"]')
  await expect(button).toBeVisible({ timeout: 10_000 })
  await button.click()
  await expect(this.page.locator(GIT_BRANCH_PICKER)).toHaveCount(0, { timeout: 10_000 })
  updateCurrentBranch(this, targetBranch)
})

Then('当前 Git 工作区应处于分支 {string}', async function (this: CradleWorld, branchName: string) {
  const fixture = recallGitWorkspace(this)
  expect(runGit(fixture.dir, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe(branchName)
})

When('我打开右侧 Aside', async function (this: CradleWorld) {
  console.warn('[step] open right aside')
  await openRightAside(this)
})

When('我切换到右侧 Aside 的 Git 标签', async function (this: CradleWorld) {
  console.warn('[step] switch right aside to git tab')
  await switchRightAsideToGit(this)
})

Then('Git 面板应该显示当前分支 {string}', async function (this: CradleWorld, branchName: string) {
  const control = this.page.locator('[data-testid="git-panel-branch-trigger"]')
  await expect(control).toBeVisible({ timeout: 10_000 })
  await expect.poll(async () => control.getAttribute('data-branch-name'), { timeout: 10_000 }).toBe(branchName)
  await expect(control).toContainText(branchName, { timeout: 10_000 })
})

Then('Git 提交图应该已渲染', async function (this: CradleWorld) {
  const graph = this.page.locator('[data-testid="git-commit-graph"]')
  await expect(graph).toBeVisible({ timeout: 10_000 })
  await expect.poll(async () => this.page.locator('[data-testid="git-graph-row"]').count(), { timeout: 10_000 }).toBeGreaterThan(0)
})

Then('Git 提交图中应该包含提交 {string}', async function (this: CradleWorld, subject: string) {
  const row = this.page
    .locator('[data-testid="git-commit-graph"] [data-testid="git-graph-row"]')
    .filter({ hasText: subject })
    .first()

  await expect(row).toBeVisible({ timeout: 10_000 })
})
