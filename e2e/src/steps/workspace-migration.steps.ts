import { Given, Then, When } from '@cucumber/cucumber'

import { WorkspaceMigrationPage } from '../support/pages/workspace-migration'
import type { CradleWorld } from '../support/world'

function migration(world: CradleWorld): WorkspaceMigrationPage {
  return new WorkspaceMigrationPage(world)
}

Given('源工作区已有 Issue、看板与 Automation', async function (this: CradleWorld) {
  await migration(this).seedSourceEntities()
})

When('我从源工作区打开迁移向导', async function (this: CradleWorld) {
  await migration(this).openFromSourceWorkspace()
})

When('我选择目标工作区并进入迁移预览', async function (this: CradleWorld) {
  await migration(this).chooseTargetAndReachReview()
})

When('我运行迁移预览', async function (this: CradleWorld) {
  await migration(this).preview()
})

Then('迁移预览应包含 1 个 Issue、1 个看板与 1 个 Automation', async function (this: CradleWorld) {
  await migration(this).expectPreviewCounts()
})

When('我确认执行工作区迁移', async function (this: CradleWorld) {
  await migration(this).migrate()
})

When('我打开 Automations 页面', async function (this: CradleWorld) {
  await migration(this).openAutomations()
})

When('我打开迁移后的看板', async function (this: CradleWorld) {
  await migration(this).openMigratedBoard()
})

Then('Issue 详情应显示目标工作区', async function (this: CradleWorld) {
  await migration(this).expectIssueOwnedByTarget()
})

Then('目标工作区应拥有迁移后的 Automation', async function (this: CradleWorld) {
  await migration(this).expectAutomationVisible()
})
