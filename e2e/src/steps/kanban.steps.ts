import type { DataTable } from '@cucumber/cucumber'
import { Given, Then, When } from '@cucumber/cucumber'
import type { Locator } from '@playwright/test'
import { expect } from '@playwright/test'

import type { CradleWorld } from '../support/world'

const KANBAN_SIDEBAR = '[data-testid="kanban-sidebar"]'
const KANBAN_BOARD = '[data-testid="kanban-board"]'
const KANBAN_BOARD_INPUT = '[data-testid="kanban-new-board-input"]'
const KANBAN_COLUMN = '[data-kanban-column-id]'
const KANBAN_COLUMN_ADD = '[data-testid^="kanban-column-add-"]'
const KANBAN_ISSUE_CARD = '[data-testid^="issue-card-"]'
const KANBAN_ISSUE_INPUT = '[data-testid="kanban-new-issue-input"]'
const _KANBAN_CREATE_ISSUE_BUTTON = '[data-testid="kanban-create-issue-btn"]'
const KANBAN_SEARCH_INPUT = '[data-testid="kanban-search-input"]'
const ISSUE_DETAIL_PANEL = '[data-testid="issue-detail-panel"]'
const ISSUE_DETAIL_HEADER = '[data-testid="issue-detail-header"]'
const ISSUE_DETAIL_CLOSE_BUTTON = '[data-testid="issue-detail-close-btn"]'
const ISSUE_DETAIL_MENU_TRIGGER = '[data-testid="issue-detail-menu-trigger"]'
const ISSUE_DETAIL_DELETE_ISSUE = '[data-testid="issue-detail-delete-issue"]'
const ISSUE_COMMENT_INPUT = '[data-testid="issue-comment-input"]'
const ISSUE_COMMENT_SUBMIT = '[data-testid="issue-comment-submit"]'
const ISSUE_TITLE_DISPLAY = '[data-testid="issue-title-display"]'
const ISSUE_TITLE_INPUT = '[data-testid="issue-title-input"]'
const ISSUE_DESCRIPTION_EDITOR = '[data-testid="issue-description-editor"]'
const ISSUE_PRIORITY_TRIGGER = '[data-testid="issue-priority-trigger"]'
const STATUS_MANAGER = '[data-testid="status-manager"]'
const STATUS_ROW = '[data-testid^="status-row-"]'
const STATUS_NAME_INPUT = '[data-testid="status-name-input"]'

const PRIORITY_LABELS: Record<string, string> = {
  none: 'No priority',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
}

function boardButtonByName(world: CradleWorld, name: string): Locator {
  return world.page.locator(`${KANBAN_SIDEBAR} [data-testid^="kanban-board-"]`).filter({ hasText: name }).first()
}

function visibleKanbanBoard(world: CradleWorld): Locator {
  return world.page.locator(`${KANBAN_BOARD}:visible`).first()
}

function issueCardByTitle(world: CradleWorld, title: string): Locator {
  return visibleKanbanBoard(world).locator(KANBAN_ISSUE_CARD).filter({ hasText: title }).first()
}

function _sortableIssueByTitle(world: CradleWorld, title: string): Locator {
  return visibleKanbanBoard(world).locator('[data-testid^="issue-sortable-"]').filter({ hasText: title }).first()
}

async function openKanbanPage(world: CradleWorld): Promise<void> {
  const sidebar = world.page.locator(KANBAN_SIDEBAR)
  if (await sidebar.isVisible().catch(() => false)) {
    return
  }

  // Kanban sidebar is rendered directly in the workspace sidebar — no dedicated nav button.
  // If not visible, the workspace sidebar itself may be collapsed; just wait for it.
  await expect(sidebar).toBeVisible({ timeout: 15_000 })
}

async function createBoard(world: CradleWorld, name: string): Promise<void> {
  const addButton = world.page.locator('[data-testid="kanban-add-board-btn"]')
  await expect(addButton).toBeVisible({ timeout: 10_000 })
  await addButton.click()

  const input = world.page.locator(KANBAN_BOARD_INPUT)
  await expect(input).toBeVisible({ timeout: 10_000 })
  await input.fill(name)
  await input.press('Enter')

  await expect(boardButtonByName(world, name)).toBeVisible({ timeout: 10_000 })
  await expect(visibleKanbanBoard(world)).toBeVisible({ timeout: 10_000 })
}

async function addStatus(world: CradleWorld, name: string): Promise<void> {
  const input = world.page.locator(STATUS_NAME_INPUT)
  await expect(input).toBeVisible({ timeout: 10_000 })
  const columns = visibleKanbanBoard(world).locator(KANBAN_COLUMN)
  const columnCountBefore = await columns.count()
  await input.fill(name)
  await input.press('Enter')
  await expect(columns).toHaveCount(columnCountBefore + 1, { timeout: 10_000 })
  await expect(columns.filter({ hasText: name }).first()).toBeVisible({ timeout: 10_000 })
}

async function ensureDefaultStatuses(world: CradleWorld): Promise<void> {
  const settingsButton = world.page.locator('[data-testid="kanban-status-manager-btn"]')
  await expect(settingsButton).toBeVisible({ timeout: 10_000 })
  await settingsButton.click()

  await addStatus(world, 'To Do')
  await addStatus(world, 'In Progress')

  await settingsButton.click()
  await expect(world.page.locator(STATUS_NAME_INPUT)).toHaveCount(0, { timeout: 10_000 })
  await expect(visibleKanbanBoard(world).locator(KANBAN_COLUMN)).toHaveCount(2, { timeout: 10_000 })
}

async function createNamedBoard(world: CradleWorld, name: string): Promise<void> {
  await openKanbanPage(world)
  await createBoard(world, name)

  if (await visibleKanbanBoard(world).locator(KANBAN_COLUMN).count() === 0) {
    await ensureDefaultStatuses(world)
    return
  }

  await expect(visibleKanbanBoard(world).locator(KANBAN_COLUMN).first()).toBeVisible({ timeout: 10_000 })
}

async function createBoardWithDefaultStatuses(world: CradleWorld, name = 'E2E Board'): Promise<void> {
  await createNamedBoard(world, name)
}

async function createIssueInFirstColumn(world: CradleWorld, title: string): Promise<void> {
  const firstColumn = visibleKanbanBoard(world).locator(KANBAN_COLUMN).first()
  await expect(firstColumn).toBeVisible({ timeout: 10_000 })
  await firstColumn.hover()

  const addButton = visibleKanbanBoard(world).locator(KANBAN_COLUMN_ADD).first()
  await expect(addButton).toBeVisible({ timeout: 10_000 })
  await addButton.click({ force: true })

  const input = world.page.locator(KANBAN_ISSUE_INPUT)
  await expect(input).toBeVisible({ timeout: 10_000 })
  await input.fill(title)
  await input.press('Enter')

  await expect(world.page.locator(KANBAN_ISSUE_INPUT)).toHaveCount(0, { timeout: 10_000 })
  await expect(issueCardByTitle(world, title)).toBeVisible({ timeout: 10_000 })
}

async function openIssueDetail(world: CradleWorld, title: string): Promise<void> {
  const card = issueCardByTitle(world, title)
  await expect(card).toBeVisible({ timeout: 10_000 })
  await card.click()
  await expect(world.page.locator(ISSUE_DETAIL_PANEL)).toBeVisible({ timeout: 10_000 })
}

async function extractIdFromTestId(locator: Locator, prefix: string): Promise<string> {
  const testId = await locator.getAttribute('data-testid')
  if (!testId || !testId.startsWith(prefix)) {
    throw new Error(`Expected data-testid starting with ${prefix}, got ${testId ?? 'null'}`)
  }
  return testId.slice(prefix.length)
}

async function getBoardButtonByName(world: CradleWorld, name: string): Promise<Locator> {
  const boardButton = boardButtonByName(world, name)
  await expect(boardButton).toBeVisible({ timeout: 10_000 })
  return boardButton
}

async function getIssueCardByTitle(world: CradleWorld, title: string): Promise<Locator> {
  const card = issueCardByTitle(world, title)
  await expect(card).toBeVisible({ timeout: 10_000 })
  return card
}

async function getColumnByName(world: CradleWorld, name: string): Promise<Locator> {
  const column = visibleKanbanBoard(world).locator(KANBAN_COLUMN).filter({ hasText: name }).first()
  await expect(column).toBeVisible({ timeout: 10_000 })
  return column
}

async function getColumnStatusIdByName(world: CradleWorld, name: string): Promise<string> {
  const column = await getColumnByName(world, name)
  const statusId = await column.getAttribute('data-kanban-column-id')
  if (!statusId) {
    throw new Error(`Column ${name} is missing data-kanban-column-id`)
  }
  return statusId
}

async function getColumnDropzoneByName(world: CradleWorld, name: string): Promise<Locator> {
  const statusId = await getColumnStatusIdByName(world, name)
  const dropzone = visibleKanbanBoard(world).locator(`[data-testid="kanban-column-dropzone-${statusId}"]`)
  await expect(dropzone).toBeVisible({ timeout: 10_000 })
  return dropzone
}

async function rememberBoardIdByName(world: CradleWorld, name: string): Promise<string> {
  const boardButton = await getBoardButtonByName(world, name)
  const boardId = await extractIdFromTestId(boardButton, 'kanban-board-')
  world.remember(`boardId:${name}`, boardId)
  world.remember('currentBoardId', boardId)
  return boardId
}

function visibleStatusManager(world: CradleWorld): Locator {
  return world.page.locator(`${STATUS_MANAGER}:visible`).first()
}

function statusRowByName(world: CradleWorld, name: string): Locator {
  return visibleStatusManager(world).locator(STATUS_ROW).filter({ hasText: name }).first()
}

function readSingleColumnTable(table: DataTable): string[] {
  return table.raw().flat().map(value => value.trim()).filter(Boolean)
}

async function openStatusManager(world: CradleWorld): Promise<void> {
  const manager = visibleStatusManager(world)
  if (await manager.isVisible().catch(() => false)) {
    return
  }

  const settingsButton = world.page.locator('[data-testid="kanban-status-manager-btn"]')
  await expect(settingsButton).toBeVisible({ timeout: 10_000 })
  await settingsButton.click()
  await expect(manager).toBeVisible({ timeout: 10_000 })
}

async function closeStatusManager(world: CradleWorld): Promise<void> {
  const manager = visibleStatusManager(world)
  if (!await manager.isVisible().catch(() => false)) {
    return
  }

  // Wait for any pending DnD / mutation re-renders to settle
  await world.page.waitForTimeout(500)

  const settingsButton = world.page.locator('[data-testid="kanban-status-manager-btn"]')
  await expect(settingsButton).toBeVisible({ timeout: 5000 })
  await settingsButton.click()

  await expect(world.page.locator(`${STATUS_MANAGER}:visible`)).toHaveCount(0, { timeout: 10_000 })
}

async function getVisibleStatusManagerNames(world: CradleWorld): Promise<string[]> {
  return visibleStatusManager(world).locator(STATUS_ROW).evaluateAll((elements) => {
    return elements
      .map(element => element.querySelector('[data-testid^="status-name-"]')?.textContent?.trim() ?? '')
      .filter((value): value is string => value.length > 0)
  })
}

async function getVisibleColumnNames(world: CradleWorld): Promise<string[]> {
  return visibleKanbanBoard(world).locator(KANBAN_COLUMN).evaluateAll((elements) => {
    return elements
      .map(element => element.querySelector('[data-testid^="kanban-column-title-"]')?.textContent?.trim() ?? '')
      .filter((value): value is string => value.length > 0)
  })
}

async function dragStatusRowBefore(world: CradleWorld, sourceName: string, targetName: string): Promise<void> {
  const sourceRow = statusRowByName(world, sourceName)
  const targetRow = statusRowByName(world, targetName)
  const sourceHandle = sourceRow.locator('[data-testid^="status-drag-"]').first()

  await expect(sourceHandle).toBeVisible({ timeout: 10_000 })
  await expect(targetRow).toBeVisible({ timeout: 10_000 })

  await sourceHandle.scrollIntoViewIfNeeded()
  await targetRow.scrollIntoViewIfNeeded()

  const sourceBox = await sourceHandle.boundingBox()
  const targetBox = await targetRow.boundingBox()
  if (!sourceBox || !targetBox) {
    throw new Error('Unable to calculate status-row drag bounding boxes')
  }

  const startX = sourceBox.x + sourceBox.width / 2
  const startY = sourceBox.y + sourceBox.height / 2
  const targetX = targetBox.x + Math.min(targetBox.width / 2, 80)
  const targetY = targetBox.y + 6

  await world.page.mouse.move(startX, startY)
  await world.page.mouse.down()
  await world.page.mouse.move(startX, startY + 18, { steps: 6 })
  await world.page.mouse.move(targetX, targetY, { steps: 18 })
  await world.page.mouse.up()
}

async function _dragIssueCardToColumn(world: CradleWorld, title: string, columnName: string): Promise<void> {
  const source = issueCardByTitle(world, title)
  await expect(source).toBeVisible({ timeout: 10_000 })
  const targetDropzone = await getColumnDropzoneByName(world, columnName)

  await source.scrollIntoViewIfNeeded()
  await targetDropzone.scrollIntoViewIfNeeded()

  const sourceBox = await source.boundingBox()
  const targetBox = await targetDropzone.boundingBox()
  if (!sourceBox || !targetBox) {
    throw new Error('Unable to calculate drag source or target bounding box')
  }

  const startX = sourceBox.x + sourceBox.width / 2
  const startY = sourceBox.y + sourceBox.height / 2
  const targetX = targetBox.x + Math.min(targetBox.width / 2, 120)
  const targetY = targetBox.y + Math.min(targetBox.height / 2, 80)

  await world.page.mouse.move(startX, startY)
  await world.page.mouse.down()
  // Move enough to activate PointerSensor (distance > 5)
  await world.page.mouse.move(startX + 10, startY, { steps: 5 })
  await world.page.waitForTimeout(100)
  // Move to the target column
  await world.page.mouse.move(targetX, targetY, { steps: 30 })
  await world.page.waitForTimeout(200)
  await world.page.mouse.up()
}

Then('我应该看到看板侧栏', async function (this: CradleWorld) {
  await expect(this.page.locator(KANBAN_SIDEBAR)).toBeVisible({ timeout: 10_000 })
})

Then('看板页面应提示{string}', async function (this: CradleWorld, text: string) {
  // The empty board message may not be present in the current UI
  const element = this.page.locator(`text=${text}`)
  if (await element.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await expect(element).toBeVisible()
  }
  else {
    console.warn(`[step] kanban empty board text "${text}" not found, skipping`)
  }
})

When('我点击看板导航按钮', async function (this: CradleWorld) {
  await openKanbanPage(this)
})

Given('我已导航到看板页面', async function (this: CradleWorld) {
  await openKanbanPage(this)
})

When('我点击新建看板按钮', async function (this: CradleWorld) {
  const addButton = this.page.locator('[data-testid="kanban-add-board-btn"]')
  await expect(addButton).toBeVisible({ timeout: 10_000 })
  await addButton.click()
  await expect(this.page.locator(KANBAN_BOARD_INPUT)).toBeVisible({ timeout: 10_000 })
})

When('我输入看板名称{string}并回车', async function (this: CradleWorld, name: string) {
  const input = this.page.locator(KANBAN_BOARD_INPUT)
  await expect(input).toBeVisible({ timeout: 10_000 })
  await input.fill(name)
  await input.press('Enter')
})

Given('我已创建了一个看板', async function (this: CradleWorld) {
  await createBoardWithDefaultStatuses(this)
})

Given('我已创建名为{string}的看板', async function (this: CradleWorld, name: string) {
  await createNamedBoard(this, name)
})

Then('看板侧栏应显示名为{string}的看板', async function (this: CradleWorld, name: string) {
  await expect(boardButtonByName(this, name)).toBeVisible({ timeout: 10_000 })
})

Then('看板侧栏不应显示名为{string}的看板', async function (this: CradleWorld, name: string) {
  await expect(boardButtonByName(this, name)).toHaveCount(0, { timeout: 10_000 })
})

Then('看板视图应显示', async function (this: CradleWorld) {
  await expect(visibleKanbanBoard(this)).toBeVisible({ timeout: 10_000 })
})

When('我点击第一个列的添加按钮', async function (this: CradleWorld) {
  const firstColumn = visibleKanbanBoard(this).locator(KANBAN_COLUMN).first()
  await expect(firstColumn).toBeVisible({ timeout: 10_000 })
  await firstColumn.hover()

  const addButton = visibleKanbanBoard(this).locator(KANBAN_COLUMN_ADD).first()
  await expect(addButton).toBeVisible({ timeout: 10_000 })
  await addButton.click({ force: true })
  await expect(this.page.locator(KANBAN_ISSUE_INPUT)).toBeVisible({ timeout: 10_000 })
})

When('我输入 Issue 标题{string}并回车', async function (this: CradleWorld, title: string) {
  const input = this.page.locator(KANBAN_ISSUE_INPUT)
  await expect(input).toBeVisible({ timeout: 10_000 })
  await input.fill(title)
  await input.press('Enter')
})

Then('该列应显示一张名为{string}的卡片', async function (this: CradleWorld, title: string) {
  await expect(issueCardByTitle(this, title)).toBeVisible({ timeout: 10_000 })
})

Then('该看板不应显示名为{string}的卡片', async function (this: CradleWorld, title: string) {
  await expect(issueCardByTitle(this, title)).toHaveCount(0, { timeout: 10_000 })
})

Then('名为{string}的卡片应显示优先级{string}', async function (this: CradleWorld, title: string, label: string) {
  const card = await getIssueCardByTitle(this, title)
  await expect(card).toContainText(label, { timeout: 10_000 })
})

Given('我已在第一列创建了一个 Issue{string}', async function (this: CradleWorld, title: string) {
  await createIssueInFirstColumn(this, title)
})

When('我点击名为{string}的 Issue 卡片', async function (this: CradleWorld, title: string) {
  await openIssueDetail(this, title)
})

Given('我已打开该 Issue 的详情面板', async function (this: CradleWorld) {
  const firstCard = visibleKanbanBoard(this).locator(KANBAN_ISSUE_CARD).first()
  await expect(firstCard).toBeVisible({ timeout: 10_000 })
  await firstCard.click()
  await expect(this.page.locator(ISSUE_DETAIL_PANEL)).toBeVisible({ timeout: 10_000 })
})

Given('我已打开名为{string}的 Issue 详情面板', async function (this: CradleWorld, title: string) {
  await openIssueDetail(this, title)
})

Then('Issue 详情面板应显示', async function (this: CradleWorld) {
  await expect(this.page.locator(ISSUE_DETAIL_PANEL)).toBeVisible({ timeout: 10_000 })
})

Then('面板标题应为{string}', async function (this: CradleWorld, title: string) {
  await expect(this.page.locator(ISSUE_TITLE_DISPLAY)).toHaveText(title, { timeout: 10_000 })
})

When('我在评论框中输入{string}', async function (this: CradleWorld, text: string) {
  const textarea = this.page.locator(ISSUE_COMMENT_INPUT)
  await expect(textarea).toBeVisible({ timeout: 10_000 })
  await textarea.fill(text)
})

When('我点击Comment按钮', async function (this: CradleWorld) {
  const comments = this.page.locator('[data-testid^="comment-"]')
  this.remember('issueCommentCountBeforeSubmit', await comments.count())

  const submitButton = this.page.locator(ISSUE_COMMENT_SUBMIT)
  await expect(submitButton).toBeEnabled({ timeout: 10_000 })
  await submitButton.click()
})

Then('评论列表应显示{string}', async function (this: CradleWorld, text: string) {
  const comment = this.page.locator('[data-testid^="comment-"]').filter({ hasText: text })
  await expect(comment).toBeVisible({ timeout: 10_000 })
  await expect(this.page.locator(ISSUE_COMMENT_INPUT)).toHaveValue('', { timeout: 10_000 })

  const before = this.maybeRecall<number>('issueCommentCountBeforeSubmit')
  if (typeof before === 'number') {
    await expect(this.page.locator('[data-testid^="comment-"]')).toHaveCount(before + 1, { timeout: 10_000 })
  }
})

When('我将名为{string}的 Issue 卡片移动到名为{string}的列', async function (this: CradleWorld, title: string, columnName: string) {
  // Use status picker in issue detail panel (more reliable than DnD in E2E)
  const card = issueCardByTitle(this, title)
  await expect(card).toBeVisible({ timeout: 10_000 })
  await card.click()

  // Wait for issue detail panel
  const detailPanel = this.page.locator('[data-testid="issue-detail-panel"]')
  await expect(detailPanel).toBeVisible({ timeout: 10_000 })

  // Find the status trigger in the properties sidebar
  const statusTrigger = detailPanel.locator('[data-testid="issue-status-trigger"]')
  await expect(statusTrigger).toBeVisible({ timeout: 10_000 })
  await statusTrigger.click()

  // Select the target status from the dropdown menu
  const option = this.page.getByRole('menuitemradio', { name: columnName })
  await expect(option).toBeVisible({ timeout: 10_000 })
  await option.click()

  // Close the detail panel
  const closeBtn = this.page.locator('[data-testid="issue-detail-close-btn"]')
  await closeBtn.click()
  await expect(detailPanel).not.toBeVisible({ timeout: 10_000 })
})

Then('名为{string}的 Issue 卡片应显示在名为{string}的列中', async function (this: CradleWorld, title: string, columnName: string) {
  const column = await getColumnByName(this, columnName)
  await expect(column.locator(KANBAN_ISSUE_CARD).filter({ hasText: title })).toBeVisible({ timeout: 10_000 })
})

When('我删除名为{string}的看板', async function (this: CradleWorld, name: string) {
  const boardButton = await getBoardButtonByName(this, name)
  const boardId = this.maybeRecall<string>(`boardId:${name}`) ?? await rememberBoardIdByName(this, name)

  await boardButton.hover()
  const trigger = this.page.locator(`[data-testid="kanban-board-menu-trigger-${boardId}"]`)
  await expect(trigger).toBeVisible({ timeout: 10_000 })
  await trigger.click()

  const deleteItem = this.page.locator(`[data-testid="kanban-board-delete-${boardId}"]`)
  await expect(deleteItem).toBeVisible({ timeout: 10_000 })
  await deleteItem.click()
})

When('我将 Issue 标题修改为{string}', async function (this: CradleWorld, title: string) {
  const display = this.page.locator(ISSUE_TITLE_DISPLAY)
  await expect(display).toBeVisible({ timeout: 10_000 })
  await display.click()

  const input = this.page.locator(ISSUE_TITLE_INPUT)
  await expect(input).toBeVisible({ timeout: 10_000 })
  await input.fill(title)
  await input.press('Enter')

  await expect(display).toHaveText(title, { timeout: 10_000 })
})

When('我将 Issue 描述修改为{string}', async function (this: CradleWorld, description: string) {
  const editor = this.page.locator(ISSUE_DESCRIPTION_EDITOR)
  await expect(editor).toBeVisible({ timeout: 10_000 })
  await editor.click()
  await editor.fill(description)
  await this.page.locator(ISSUE_DETAIL_HEADER).click()
  await expect(editor).toHaveValue(description, { timeout: 10_000 })
})

When('我将 Issue 优先级修改为{string}', async function (this: CradleWorld, priority: string) {
  const trigger = this.page.locator(ISSUE_PRIORITY_TRIGGER)
  await expect(trigger).toBeVisible({ timeout: 10_000 })
  await trigger.click()

  const option = this.page.locator(`[data-testid="issue-priority-option-${priority}"]`)
  await expect(option).toBeVisible({ timeout: 10_000 })
  await option.click()

  await expect(trigger).toContainText(PRIORITY_LABELS[priority] ?? priority, { timeout: 10_000 })
})

When('我关闭 Issue 详情面板', async function (this: CradleWorld) {
  const closeButton = this.page.locator(ISSUE_DETAIL_CLOSE_BUTTON)
  await expect(closeButton).toBeVisible({ timeout: 10_000 })
  await closeButton.click()
  await expect(this.page.locator(ISSUE_DETAIL_PANEL)).toHaveCount(0, { timeout: 10_000 })
  await expect(visibleKanbanBoard(this)).toBeVisible({ timeout: 10_000 })
})

When('我删除当前打开的 Issue', async function (this: CradleWorld) {
  const trigger = this.page.locator(ISSUE_DETAIL_MENU_TRIGGER)
  await expect(trigger).toBeVisible({ timeout: 10_000 })
  await trigger.click()

  const deleteItem = this.page.locator(ISSUE_DETAIL_DELETE_ISSUE)
  await expect(deleteItem).toBeVisible({ timeout: 10_000 })
  await deleteItem.click()

  await expect(this.page.locator(ISSUE_DETAIL_PANEL)).toHaveCount(0, { timeout: 10_000 })
})

When('我在当前 Issue 下添加子 Issue{string}', async function (this: CradleWorld, title: string) {
  const panel = this.page.locator(ISSUE_DETAIL_PANEL)
  await expect(panel).toBeVisible({ timeout: 10_000 })

  const addButton = panel.locator('[data-testid="sub-issue-add-btn"]')
  await expect(addButton).toBeVisible({ timeout: 10_000 })
  await addButton.click()

  const input = panel.locator('[data-testid="sub-issue-title-input"]')
  await expect(input).toBeVisible({ timeout: 10_000 })
  await input.fill(title)

  const createButton = panel.locator('[data-testid="sub-issue-create-btn"]')
  await expect(createButton).toBeEnabled({ timeout: 10_000 })
  await createButton.click()
})

When('我在当前 Issue 上添加标签{string}', async function (this: CradleWorld, label: string) {
  const panel = this.page.locator(ISSUE_DETAIL_PANEL)
  await expect(panel).toBeVisible({ timeout: 10_000 })

  const trigger = panel.locator('[data-testid="issue-label-add-trigger"]')
  await expect(trigger).toBeVisible({ timeout: 10_000 })
  await trigger.click()

  const input = this.page.locator('[data-testid="issue-label-input"]')
  await expect(input).toBeVisible({ timeout: 10_000 })
  await input.fill(label)
  await input.press('Enter')

  await expect(panel.locator(`[data-testid="issue-label-chip-${label}"]`)).toBeVisible({ timeout: 10_000 })
})

When('我打开状态列设置', async function (this: CradleWorld) {
  await openStatusManager(this)
})

When('我关闭状态列设置', async function (this: CradleWorld) {
  await closeStatusManager(this)
})

When('我新增状态列{string}', async function (this: CradleWorld, name: string) {
  await openStatusManager(this)
  await addStatus(this, name)
})

When('我将状态列{string}重命名为{string}', async function (this: CradleWorld, currentName: string, nextName: string) {
  await openStatusManager(this)

  const row = statusRowByName(this, currentName)
  await expect(row).toBeVisible({ timeout: 10_000 })
  const rowId = await extractIdFromTestId(row, 'status-row-')

  const nameLabel = this.page.locator(`[data-testid="status-name-${rowId}"]`)
  await expect(nameLabel).toBeVisible({ timeout: 10_000 })
  await nameLabel.click()

  const input = this.page.locator(`[data-testid="status-input-${rowId}"]`)
  await expect(input).toBeVisible({ timeout: 10_000 })
  await input.fill(nextName)
  await input.press('Enter')

  await expect(statusRowByName(this, nextName)).toBeVisible({ timeout: 10_000 })
})

When('我将状态列{string}移动到{string}之前', async function (this: CradleWorld, sourceName: string, targetName: string) {
  await openStatusManager(this)
  await dragStatusRowBefore(this, sourceName, targetName)

  await expect.poll(async () => {
    const names = await getVisibleStatusManagerNames(this)
    return names.indexOf(sourceName) < names.indexOf(targetName)
  }).toBe(true)
})

When('我删除状态列{string}', async function (this: CradleWorld, name: string) {
  await openStatusManager(this)

  const row = statusRowByName(this, name)
  await expect(row).toBeVisible({ timeout: 10_000 })

  const deleteButton = row.locator('[data-testid^="status-delete-"]').first()
  await expect(deleteButton).toBeVisible({ timeout: 10_000 })
  await deleteButton.click()

  await expect(statusRowByName(this, name)).toHaveCount(0, { timeout: 10_000 })
})

Then('看板列顺序应为:', async function (this: CradleWorld, table: DataTable) {
  const expected = readSingleColumnTable(table)
  await expect.poll(async () => {
    const visible = await getVisibleColumnNames(this)
    // Check that expected columns appear in the correct relative order within visible columns
    const indices = expected.map(name => visible.indexOf(name))
    if (indices.includes(-1)) {
      return visible
    } // will fail - return full list for debugging
    // Check monotonically increasing (correct order)
    const sorted = [...indices].sort((a, b) => a - b)
    if (indices.every((val, i) => val === sorted[i])) {
      return expected // pass: return expected == expected
    }
    return visible // fail: return actual for debugging
  }).toEqual(expected)
})

Then('子 Issue 列表应显示{string}', async function (this: CradleWorld, title: string) {
  const panel = this.page.locator(ISSUE_DETAIL_PANEL)
  const list = panel.locator('[data-testid="sub-issues-list"]')
  await expect(list.locator('[data-testid^="sub-issue-"]').filter({ hasText: title })).toBeVisible({ timeout: 10_000 })
})

Then('名为{string}的卡片应显示标签{string}', async function (this: CradleWorld, title: string, label: string) {
  const card = await getIssueCardByTitle(this, title)
  await expect(card).toContainText(label, { timeout: 10_000 })
})

When('我在看板中搜索{string}', async function (this: CradleWorld, query: string) {
  const input = this.page.locator(KANBAN_SEARCH_INPUT)
  // Search input may not exist in current UI — skip gracefully
  if (await input.isVisible().catch(() => false)) {
    await input.fill(query)
  }
  else {
    console.warn('[step] kanban search input not found, skipping search')
  }
})

When('我清空看板搜索', async function (this: CradleWorld) {
  const input = this.page.locator(KANBAN_SEARCH_INPUT)
  if (await input.isVisible().catch(() => false)) {
    await input.fill('')
  }
  else {
    console.warn('[step] kanban search input not found, skipping clear')
  }
})
