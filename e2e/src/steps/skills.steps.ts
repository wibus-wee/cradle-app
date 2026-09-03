import { Given, Then, When } from '@cucumber/cucumber'

import {
  configureWorkspaceSkillSimulator,
  WORKSPACE_SKILL_REPLY,
} from '../support/helpers/skill-scenario'
import type { CradleWorld } from '../support/world'

Given('我已配置会校验 Workspace Skill 的 Claude Agent Simulator', async function (this: CradleWorld) {
  await configureWorkspaceSkillSimulator(this)
})

Given('我通过 Workspace Skills 创建了发布判断 Skill', async function (this: CradleWorld) {
  await this.skillsPage.createWorkspaceSkill()
})

When('我在新建聊天中选择并调用该 Workspace Skill', async function (this: CradleWorld) {
  await this.skillsPage.invokeWorkspaceSkill()
})

Then('Claude Agent 应返回 Workspace Skill 的脚本化结果', async function (this: CradleWorld) {
  await this.chat.expectAssistantContains(WORKSPACE_SKILL_REPLY)
})

Then('刷新后 Skill 调用应保留在历史消息中', async function (this: CradleWorld) {
  await this.skillsPage.expectPersistedInvocation()
})

When('我从 Workspace Skills 删除该 Skill', async function (this: CradleWorld) {
  await this.skillsPage.deleteWorkspaceSkill()
})

Then('刷新后新聊天不应再提供该 Skill', async function (this: CradleWorld) {
  await this.skillsPage.expectSkillUnavailableForNewTurn()
})

Then('已完成会话仍应保留该 Skill 的调用证据', async function (this: CradleWorld) {
  await this.skillsPage.expectHistoricalInvocationStillVisible()
})
