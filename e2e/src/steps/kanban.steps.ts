import type { DataTable } from '@cucumber/cucumber'
import { Given, Then, When } from '@cucumber/cucumber'

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

Then('名为{string}的卡片应显示标签{string}', async function (this: CradleWorld, title: string, label: string) {
  await this.kanbanPage.expectCardLabel(title, label)
})

When('我在看板中搜索{string}', async function (this: CradleWorld, query: string) {
  await this.kanbanPage.search(query)
})

When('我清空看板搜索', async function (this: CradleWorld) {
  await this.kanbanPage.clearSearch()
})
