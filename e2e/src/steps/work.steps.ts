import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import { configureWorkWriteToolLoopSimulator } from '../support/helpers/chat-scenario'
import type { CradleWorld } from '../support/world'

Given('我已配置会在 Work worktree 写文件的 Claude Agent Simulator', async function (this: CradleWorld) {
  await configureWorkWriteToolLoopSimulator(this)
})

When('我打开 New Work', async function (this: CradleWorld) {
  // This scenario covers the local Work lifecycle, not GitHub OAuth. Project a
  // connected identity at the browser boundary so the real New Work surface is
  // available while every Work/session/git request still reaches the server.
  await this.page.route('**/github-auth/connection', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        state: 'connected',
        appName: 'Cradle E2E',
        appSlug: 'cradle-e2e',
        installationUrl: null,
        viewer: { login: 'cradle-e2e', avatarUrl: null, profileUrl: null },
        expiresAt: null,
        refreshTokenExpiresAt: null,
        error: null,
      }),
    })
  })
  await this.page.reload({ waitUntil: 'domcontentloaded' })
  await this.workPage.open()
})

When('我在 New Work 中选择第一个工作区', async function (this: CradleWorld) {
  await this.workPage.selectFirstWorkspace()
})

When('我在 New Work 中选择 Claude Agent Simulator', async function (this: CradleWorld) {
  await this.newChat.selectRuntime('Claude Agent')
  await this.newChat.selectProvider(/E2E Claude Agent/i)
})

When('我输入 Work 目标{string}', async function (this: CradleWorld, goal: string) {
  this.remember('work.goal', goal)
  await this.workPage.fillGoal(goal)
})

When('我启动 Work', async function (this: CradleWorld) {
  await this.workPage.start()
})

Then('Work 应创建受管 worktree 与持久化主会话', async function (this: CradleWorld) {
  const sessionId = await this.chat.sessionId()
  await this.workPage.expectPersisted(this.recall<string>('work.goal'), sessionId)
  await this.page.reload({ waitUntil: 'domcontentloaded' })
  await this.chat.waitVisible()
  await this.workPage.openRuntimePanel()
  const panel = this.page.locator('[data-testid="right-aside-panel-runtime"]')
  await expect(panel).toContainText('Work')
  await expect(panel).toContainText(this.recall<string>('work.goal'))
  await expect(panel.getByText('Files', { exact: true }).locator('..')).toContainText('1')
})
