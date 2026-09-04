import type { DataTable } from '@cucumber/cucumber'
import { Given, Then, When } from '@cucumber/cucumber'

import {
  configureCancelableIssueDelegation,
  configureCompletedIssueDelegation,
  configureIsolatedIssueDelegation,
  enqueueIssueAgentRerunResponse,
  ISSUE_AGENT_WORK_CONTENT,
  ISSUE_AGENT_WORK_FILE,
  releaseIssueAgentRerun,
} from '../support/helpers/issue-agent-scenario'
import type { CradleWorld } from '../support/world'

Then('我应该看到看板侧栏', async function (this: CradleWorld) {
  await this.kanbanPage.expectSidebarVisible()
})

Then('看板页面应提示{string}', async function (this: CradleWorld, text: string) {
  await this.kanbanPage.expectEmptyBoardText(text)
})

When('我点击看板导航按钮', async function (this: CradleWorld) {
  await this.kanbanPage.open()
})

Given('我已导航到看板页面', async function (this: CradleWorld) {
  await this.kanbanPage.open()
})

When('我点击新建看板按钮', async function (this: CradleWorld) {
  await this.kanbanPage.clickNewBoardButton()
})

When('我输入看板名称{string}并回车', async function (this: CradleWorld, name: string) {
  await this.kanbanPage.enterBoardName(name)
})

Given('我已创建了一个看板', async function (this: CradleWorld) {
  await this.kanbanPage.createBoardWithDefaultStatuses()
})

Given('我已创建名为{string}的看板', async function (this: CradleWorld, name: string) {
  await this.kanbanPage.createNamedBoard(name)
})

Then('看板侧栏应显示名为{string}的看板', async function (this: CradleWorld, name: string) {
  await this.kanbanPage.expectSidebarBoardVisible(name)
})

Then('看板侧栏不应显示名为{string}的看板', async function (this: CradleWorld, name: string) {
  await this.kanbanPage.expectSidebarBoardHidden(name)
})

Then('看板视图应显示', async function (this: CradleWorld) {
  await this.kanbanPage.expectBoardVisible()
})

When('我点击第一个列的添加按钮', async function (this: CradleWorld) {
  await this.kanbanPage.clickFirstColumnAddButton()
})

When('我输入 Issue 标题{string}并回车', async function (this: CradleWorld, title: string) {
  await this.kanbanPage.enterIssueTitle(title)
})

Then('该列应显示一张名为{string}的卡片', async function (this: CradleWorld, title: string) {
  await this.kanbanPage.expectCardVisible(title)
})

Then('该看板不应显示名为{string}的卡片', async function (this: CradleWorld, title: string) {
  await this.kanbanPage.expectCardHidden(title)
})

Then('名为{string}的卡片应显示优先级{string}', async function (this: CradleWorld, title: string, label: string) {
  await this.kanbanPage.expectCardPriority(title, label)
})

Given('我已在第一列创建了一个 Issue{string}', async function (this: CradleWorld, title: string) {
  await this.kanbanPage.createIssueInFirstColumn(title)
})

When('我点击名为{string}的 Issue 卡片', async function (this: CradleWorld, title: string) {
  await this.kanbanPage.openIssueDetail(title)
})

Given('我已打开该 Issue 的详情面板', async function (this: CradleWorld) {
  await this.kanbanPage.openFirstIssueDetail()
})

Given('我已打开名为{string}的 Issue 详情面板', async function (this: CradleWorld, title: string) {
  await this.kanbanPage.openIssueDetail(title)
})

Then('Issue 详情面板应显示', async function (this: CradleWorld) {
  await this.kanbanPage.expectIssueDetailVisible()
})

Then('面板标题应为{string}', async function (this: CradleWorld, title: string) {
  await this.kanbanPage.expectPanelTitle(title)
})

When('我将当前 Issue 标记为被{string}阻塞', async function (this: CradleWorld, title: string) {
  await this.kanbanPage.addBlockedByRelation(title)
})

Then('当前 Issue 应显示被{string}阻塞的关系', async function (this: CradleWorld, title: string) {
  await this.kanbanPage.expectIssueRelation('Blocked by', title)
})

Then('当前 Issue 应显示阻塞{string}的关系', async function (this: CradleWorld, title: string) {
  await this.kanbanPage.expectIssueRelation('Blocks', title)
})

When('我通过该关系打开 Issue {string}', async function (this: CradleWorld, title: string) {
  await this.kanbanPage.openRelatedIssue('Blocked by', title)
})

When('我删除当前 Issue 与{string}的阻塞关系', async function (this: CradleWorld, title: string) {
  await this.kanbanPage.removeIssueRelation('Blocks', title)
})

Then('当前 Issue 应不再显示任何关系', async function (this: CradleWorld) {
  await this.kanbanPage.expectNoIssueRelations()
})

When('我在评论框中输入{string}', async function (this: CradleWorld, text: string) {
  await this.kanbanPage.fillComment(text)
})

When('我点击Comment按钮', async function (this: CradleWorld) {
  await this.kanbanPage.clickCommentButton()
})

Then('评论列表应显示{string}', async function (this: CradleWorld, text: string) {
  await this.kanbanPage.expectCommentVisible(text)
})

When('我将名为{string}的 Issue 卡片移动到名为{string}的列', async function (
  this: CradleWorld,
  title: string,
  columnName: string,
) {
  await this.kanbanPage.moveIssueCardToColumn(title, columnName)
})

Then('名为{string}的 Issue 卡片应显示在名为{string}的列中', async function (
  this: CradleWorld,
  title: string,
  columnName: string,
) {
  await this.kanbanPage.expectIssueCardInColumn(title, columnName)
})

When('我删除名为{string}的看板', async function (this: CradleWorld, name: string) {
  await this.kanbanPage.deleteBoard(name)
})

When('我将 Issue 标题修改为{string}', async function (this: CradleWorld, title: string) {
  await this.kanbanPage.renameIssueTitle(title)
})

When('我将 Issue 描述修改为{string}', async function (this: CradleWorld, description: string) {
  await this.kanbanPage.updateIssueDescription(description)
})

When('我将 Issue 优先级修改为{string}', async function (this: CradleWorld, priority: string) {
  await this.kanbanPage.updateIssuePriority(priority)
})

When('我关闭 Issue 详情面板', async function (this: CradleWorld) {
  await this.kanbanPage.closeIssueDetail()
})

When('我删除当前打开的 Issue', async function (this: CradleWorld) {
  await this.kanbanPage.deleteOpenIssue()
})

When('我在当前 Issue 下添加子 Issue{string}', async function (this: CradleWorld, title: string) {
  await this.kanbanPage.addSubIssueToOpenIssue(title)
})

When('我在当前 Issue 上添加标签{string}', async function (this: CradleWorld, label: string) {
  await this.kanbanPage.addLabelToOpenIssue(label)
})

When('我打开状态列设置', async function (this: CradleWorld) {
  await this.kanbanPage.openStatusManager()
})

When('我关闭状态列设置', async function (this: CradleWorld) {
  await this.kanbanPage.closeStatusManager()
})

When('我新增状态列{string}', async function (this: CradleWorld, name: string) {
  await this.kanbanPage.addStatusColumn(name)
})

When('我将状态列{string}重命名为{string}', async function (this: CradleWorld, currentName: string, nextName: string) {
  await this.kanbanPage.renameStatusColumn(currentName, nextName)
})

When('我将状态列{string}移动到{string}之前', async function (
  this: CradleWorld,
  sourceName: string,
  targetName: string,
) {
  await this.kanbanPage.moveStatusColumnBefore(sourceName, targetName)
})

When('我删除状态列{string}', async function (this: CradleWorld, name: string) {
  await this.kanbanPage.deleteStatusColumn(name)
})

Then('看板列顺序应为:', async function (this: CradleWorld, table: DataTable) {
  await this.kanbanPage.expectColumnOrder(table)
})

Then('子 Issue 列表应显示{string}', async function (this: CradleWorld, title: string) {
  await this.kanbanPage.expectSubIssueVisible(title)
})

Then('当前 Issue 的子 Issue 进度应为{string}', async function (this: CradleWorld, progress: string) {
  await this.kanbanPage.expectSubIssueProgress(progress)
})

When('我从当前 Issue 打开子 Issue {string}', async function (this: CradleWorld, title: string) {
  await this.kanbanPage.openSubIssue(title)
})

Then('当前 Issue 应显示父 Issue {string}链接', async function (this: CradleWorld, title: string) {
  await this.kanbanPage.expectParentIssueLink(title)
})

When('我通过父 Issue 链接打开 Issue {string}', async function (this: CradleWorld, title: string) {
  await this.kanbanPage.openParentIssue(title)
})

When('我从子 Issue {string}卡片的父链接打开 Issue {string}', async function (
  this: CradleWorld,
  childTitle: string,
  parentTitle: string,
) {
  await this.kanbanPage.openParentIssueFromCard(childTitle, parentTitle)
})

Then('当前 Issue 应不再显示子 Issue', async function (this: CradleWorld) {
  await this.kanbanPage.expectNoSubIssues()
})

Then('名为{string}的卡片应显示标签{string}', async function (this: CradleWorld, title: string, label: string) {
  await this.kanbanPage.expectCardLabel(title, label)
})

When('我在看板中搜索{string}', async function (this: CradleWorld, query: string) {
  await this.kanbanPage.search(query)
})

When('我清空看板搜索', async function (this: CradleWorld) {
  await this.kanbanPage.clearSearch()
})

Given('我已配置 Issue {string}的完成与重跑 Claude Agent Simulator', async function (
  this: CradleWorld,
  issueTitle: string,
) {
  await configureCompletedIssueDelegation(this, issueTitle)
})

Given('我已配置 Issue {string}的可取消慢速 Claude Agent Simulator', async function (
  this: CradleWorld,
  issueTitle: string,
) {
  await configureCancelableIssueDelegation(this, issueTitle)
})

Given('我已配置 Issue {string}的隔离 Work Claude Agent Simulator', async function (
  this: CradleWorld,
  issueTitle: string,
) {
  await configureIsolatedIssueDelegation(this, issueTitle)
})

When('我启用当前 Issue 的隔离 Work 委派', async function (this: CradleWorld) {
  await this.kanbanPage.enableOpenIssueIsolatedDelegation()
})

When('我将当前 Issue 委派给 Agent {string}', async function (this: CradleWorld, agentName: string) {
  await this.kanbanPage.delegateOpenIssueToAgent(agentName)
})

When('我取消当前 Issue 的委派', async function (this: CradleWorld) {
  await this.kanbanPage.undelegateOpenIssue()
})

Then('当前 Issue 的 Agent Session 阶段应为{string}', async function (this: CradleWorld, phase: string) {
  await this.kanbanPage.expectAgentSessionPhase(phase)
})

Then('当前 Issue 活动应包含{string}', async function (this: CradleWorld, text: string) {
  await this.kanbanPage.expectIssueActivity(text)
})

When('我重跑当前 Issue 的 Agent Session', async function (this: CradleWorld) {
  enqueueIssueAgentRerunResponse(this)
  await this.kanbanPage.rerunOpenIssueAgentSession()
})

When('我释放当前 Issue 的重跑门控', async function (this: CradleWorld) {
  await releaseIssueAgentRerun(this)
})

When('我打开当前 Issue 的 Agent Chat', async function (this: CradleWorld) {
  await this.kanbanPage.openIssueAgentChat()
})

When('我打开当前 Issue 的已链接 Chat', async function (this: CradleWorld) {
  await this.kanbanPage.openLinkedIssueChat()
})

When('我重新加载并重新打开 Issue {string}', async function (this: CradleWorld, title: string) {
  await this.kanbanPage.reloadAndReopenIssue(title)
})

Then('当前 Issue 委派应创建关联的隔离 Work {string}', async function (
  this: CradleWorld,
  issueTitle: string,
) {
  await this.workPage.expectIssueDelegationWork({
    issueTitle,
    sessionId: await this.chat.sessionId(),
    fileName: ISSUE_AGENT_WORK_FILE,
    fileContent: ISSUE_AGENT_WORK_CONTENT,
  })
})

Then('已取消的隔离 Issue 委派应保留关联 Work {string}', async function (
  this: CradleWorld,
  issueTitle: string,
) {
  await this.workPage.expectRetainedCanceledIssueWork({
    issueTitle,
    sessionId: await this.chat.sessionId(),
  })
})
