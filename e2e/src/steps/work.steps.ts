import { existsSync } from 'node:fs'

import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import {
  configureActiveWorkWorkspaceRemovalSimulator,
  configureStoppableWorkRecoverySimulator,
  configureWorkFailureRecoverySimulator,
  configureWorkWriteToolLoopSimulator,
  expectSlowStreamGateCanceled,
  waitForSlowStreamGate,
  WORK_FAILURE_RECOVERY_FILE_CONTENT,
  WORK_FAILURE_RECOVERY_FILE_NAME,
  WORK_STOP_RECOVERY_FILE_CONTENT,
  WORK_STOP_RECOVERY_FILE_NAME,
} from '../support/helpers/chat-scenario'
import type { CradleWorld } from '../support/world'

Given('我已配置会在 Work worktree 写文件的 Claude Agent Simulator', async function (this: CradleWorld) {
  await configureWorkWriteToolLoopSimulator(this)
})

Given('我已配置首个 Work 请求失败后可恢复的 Claude Agent Simulator', async function (this: CradleWorld) {
  await configureWorkFailureRecoverySimulator(this)
})

Given('我已配置可停止后恢复的 Work Claude Agent Simulator', async function (this: CradleWorld) {
  await configureStoppableWorkRecoverySimulator(this)
})

Given('我已配置会在删除工作区前保持运行的 Work Claude Agent Simulator', async function (this: CradleWorld) {
  await configureActiveWorkWorkspaceRemovalSimulator(this)
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

When('我输入 Work 验收标准{string}', async function (this: CradleWorld, criterion: string) {
  this.remember('work.acceptanceCriterion', criterion)
  await this.workPage.fillAcceptanceCriteria(criterion)
})

When('我启动 Work', async function (this: CradleWorld) {
  await this.workPage.start()
})

Then('Work 应创建受管 worktree 与持久化主会话', async function (this: CradleWorld) {
  const sessionId = await this.chat.sessionId()
  const workId = await this.workPage.expectPersisted(this.recall<string>('work.goal'), sessionId)
  this.remember('work.id', workId)
  await this.workPage.expectAcceptanceCriterion(workId, this.recall<string>('work.acceptanceCriterion'))
  await this.page.reload({ waitUntil: 'domcontentloaded' })
  await this.chat.waitVisible()
  await this.workPage.openRuntimePanel()
  const panel = this.page.locator('[data-testid="right-aside-panel-runtime"]')
  await expect(panel).toContainText('Work')
  await expect(panel).toContainText(this.recall<string>('work.goal'))
  await expect(panel.getByText('Files', { exact: true }).locator('..')).toContainText('1')
})

Then('Work 应展示带权威证据的状态与恢复承诺', async function (this: CradleWorld) {
  await this.workPage.expectExplainableState()
})

Then('Needs me 应给出可直接打开该 Work 的下一行动', async function (this: CradleWorld) {
  await this.workPage.expectAttentionDirectAction(this.recall<string>('work.id'))
})

Then('失败后的 Work 应保留唯一受管主会话', async function (this: CradleWorld) {
  await expectWorkToKeepSinglePrimarySession(this)
})

Then('停止后的 Work 应保留唯一受管主会话', async function (this: CradleWorld) {
  await expectWorkToKeepSinglePrimarySession(this)
})

async function expectWorkToKeepSinglePrimarySession(world: CradleWorld): Promise<void> {
  const sessionId = await world.chat.sessionId()
  world.remember('work.primary-session-id', sessionId)
  await world.workPage.expectSinglePersistedPrimarySession(
    world.recall<string>('work.goal'),
    sessionId,
  )
}

Then('恢复后的 Work 应仍使用原受管主会话并写入验证文件', async function (this: CradleWorld) {
  const primarySessionId = this.recall<string>('work.primary-session-id')
  expect(await this.chat.sessionId()).toBe(primarySessionId)
  await this.workPage.expectSinglePersistedPrimarySession(
    this.recall<string>('work.goal'),
    primarySessionId,
    {
      name: WORK_FAILURE_RECOVERY_FILE_NAME,
      content: WORK_FAILURE_RECOVERY_FILE_CONTENT,
    },
  )
})

Then('停止恢复后的 Work 应仍使用原受管主会话并写入验证文件', async function (this: CradleWorld) {
  const primarySessionId = this.recall<string>('work.primary-session-id')
  expect(await this.chat.sessionId()).toBe(primarySessionId)
  await this.workPage.expectSinglePersistedPrimarySession(
    this.recall<string>('work.goal'),
    primarySessionId,
    {
      name: WORK_STOP_RECOVERY_FILE_NAME,
      content: WORK_STOP_RECOVERY_FILE_CONTENT,
    },
  )
})

Then('我记住当前 Work 工作区关联资源', async function (this: CradleWorld) {
  const sessionId = await this.chat.sessionId()
  const sessionResponse = await fetch(`${this.params.serverUrl}/sessions/${sessionId}`)
  expect(sessionResponse.ok).toBe(true)
  const session = await sessionResponse.json() as { workspaceId: string | null }
  expect(session.workspaceId).not.toBeNull()

  const worksResponse = await fetch(`${this.params.serverUrl}/works?workspaceId=${session.workspaceId}`)
  expect(worksResponse.ok).toBe(true)
  const works = await worksResponse.json() as {
    items: Array<{ id: string, primarySessionId: string }>
  }
  const work = works.items.find(candidate => candidate.primarySessionId === sessionId)
  expect(work).toBeDefined()

  const workResponse = await fetch(`${this.params.serverUrl}/works/${work!.id}`)
  expect(workResponse.ok).toBe(true)
  const detail = await workResponse.json() as {
    execution: { worktreePath: string | null }
  }
  expect(detail.execution.worktreePath).not.toBeNull()
  expect(existsSync(detail.execution.worktreePath!)).toBe(true)

  this.remember('workspace-removal.resources', {
    workspaceId: session.workspaceId!,
    sessionId,
    workId: work!.id,
    worktreePath: detail.execution.worktreePath!,
  })
})

Then('已删除工作区不应保留会话、Work、worktree 或磁盘 checkout', async function (this: CradleWorld) {
  const resources = this.recall<{
    workspaceId: string
    sessionId: string
    workId: string
    worktreePath: string
  }>('workspace-removal.resources')

  const [workspaceResponse, sessionResponse, workResponse, worktreesResponse] = await Promise.all([
    fetch(`${this.params.serverUrl}/workspaces/${resources.workspaceId}`),
    fetch(`${this.params.serverUrl}/sessions/${resources.sessionId}`),
    fetch(`${this.params.serverUrl}/works/${resources.workId}`),
    fetch(`${this.params.serverUrl}/workspaces/${resources.workspaceId}/worktrees`),
  ])

  expect(workspaceResponse.ok).toBe(true)
  expect(await workspaceResponse.json()).toBeNull()
  expect(sessionResponse.status).toBe(404)
  expect(workResponse.status).toBe(404)
  expect(worktreesResponse.ok).toBe(true)
  expect(await worktreesResponse.json()).toEqual([])
  expect(existsSync(resources.worktreePath)).toBe(false)
})

Then('已删除 Work 的慢速 Provider 响应应已被取消', function (this: CradleWorld) {
  expectSlowStreamGateCanceled(this)
})

Then('Work 的慢速 Provider 响应已到达门控', async function (this: CradleWorld) {
  await waitForSlowStreamGate(this)
})
