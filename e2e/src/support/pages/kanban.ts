import type { DataTable } from '@cucumber/cucumber'
import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'

interface KanbanPageOwner {
  page: Page
  remember: <T>(key: string, value: T) => void
  maybeRecall: <T>(key: string) => T | undefined
}

export class KanbanPage {
  private static readonly KANBAN_SIDEBAR = '[data-testid="kanban-sidebar"]'
  private static readonly KANBAN_BOARD = '[data-testid="kanban-board"]'
  private static readonly KANBAN_BOARD_INPUT = '[data-testid="kanban-new-board-input"]'
  private static readonly KANBAN_COLUMN = '[data-kanban-column-id]'
  private static readonly KANBAN_COLUMN_ADD = '[data-testid^="kanban-column-add-"]'
  private static readonly KANBAN_ISSUE_CARD = '[data-testid^="issue-card-"]'
  private static readonly KANBAN_ISSUE_INPUT = '[data-testid="kanban-new-issue-input"]'
  private static readonly _KANBAN_CREATE_ISSUE_BUTTON = '[data-testid="kanban-create-issue-btn"]'
  private static readonly KANBAN_SEARCH_INPUT = '[data-testid="kanban-search-input"]'
  private static readonly ISSUE_DETAIL_PANEL = '[data-testid="issue-detail-panel"]'
  private static readonly ISSUE_DETAIL_HEADER = '[data-testid="issue-detail-header"]'
  private static readonly ISSUE_DETAIL_CLOSE_BUTTON = '[data-testid="issue-detail-close-btn"]'
  private static readonly ISSUE_DETAIL_MENU_TRIGGER = '[data-testid="issue-detail-menu-trigger"]'
  private static readonly ISSUE_DETAIL_DELETE_ISSUE = '[data-testid="issue-detail-delete-issue"]'
  private static readonly ISSUE_COMMENT_INPUT = '[data-testid="issue-comment-input"]'
  private static readonly ISSUE_COMMENT_SUBMIT = '[data-testid="issue-comment-submit"]'
  private static readonly ISSUE_TITLE_DISPLAY = '[data-testid="issue-title-display"]'
  private static readonly ISSUE_TITLE_INPUT = '[data-testid="issue-title-input"]'
  private static readonly ISSUE_DESCRIPTION_EDITOR = '[data-testid="issue-description-editor"]'
  private static readonly ISSUE_PRIORITY_TRIGGER = '[data-testid="issue-priority-trigger"]'
  private static readonly STATUS_MANAGER = '[data-testid="status-manager"]'
  private static readonly STATUS_ROW = '[data-testid^="status-row-"]'
  private static readonly STATUS_NAME_INPUT = '[data-testid="status-name-input"]'

  private static readonly PRIORITY_LABELS: Record<string, string> = {
    none: 'No priority',
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    urgent: 'Urgent',
  }

  constructor(private readonly owner: KanbanPageOwner) {}

  private get page(): Page {
    return this.owner.page
  }

  private boardButtonByName(name: string): Locator {
    return this.page.locator(`${KanbanPage.KANBAN_SIDEBAR} [data-testid^="kanban-board-"]`).filter({ hasText: name }).first()
  }

  private visibleKanbanBoard(): Locator {
    return this.page.locator(`${KanbanPage.KANBAN_BOARD}:visible`).first()
  }

  private issueCardByTitle(title: string): Locator {
    return this.visibleKanbanBoard().locator(KanbanPage.KANBAN_ISSUE_CARD).filter({ hasText: title }).first()
  }

  private _sortableIssueByTitle(title: string): Locator {
    return this.visibleKanbanBoard().locator('[data-testid^="issue-sortable-"]').filter({ hasText: title }).first()
  }

  private async createBoard(name: string): Promise<void> {
    const addButton = this.page.locator('[data-testid="kanban-add-board-btn"]')
    await expect(addButton).toBeVisible({ timeout: 10_000 })
    await addButton.click()

    const input = this.page.locator(KanbanPage.KANBAN_BOARD_INPUT)
    await expect(input).toBeVisible({ timeout: 10_000 })
    await input.fill(name)
    await input.press('Enter')

    await expect(this.boardButtonByName(name)).toBeVisible({ timeout: 10_000 })
    await expect(this.visibleKanbanBoard()).toBeVisible({ timeout: 10_000 })
  }

  private async addStatus(name: string): Promise<void> {
    const input = this.page.locator(KanbanPage.STATUS_NAME_INPUT)
    await expect(input).toBeVisible({ timeout: 10_000 })
    const columns = this.visibleKanbanBoard().locator(KanbanPage.KANBAN_COLUMN)
    const columnCountBefore = await columns.count()
    await input.fill(name)
    await input.press('Enter')
    await expect(columns).toHaveCount(columnCountBefore + 1, { timeout: 10_000 })
    await expect(columns.filter({ hasText: name }).first()).toBeVisible({ timeout: 10_000 })
  }

  private async ensureDefaultStatuses(): Promise<void> {
    const settingsButton = this.page.locator('[data-testid="kanban-status-manager-btn"]')
    await expect(settingsButton).toBeVisible({ timeout: 10_000 })
    await settingsButton.click()

    await this.addStatus('To Do')
    await this.addStatus('In Progress')

    await settingsButton.click()
    await expect(this.page.locator(KanbanPage.STATUS_NAME_INPUT)).toHaveCount(0, { timeout: 10_000 })
    await expect(this.visibleKanbanBoard().locator(KanbanPage.KANBAN_COLUMN)).toHaveCount(2, { timeout: 10_000 })
  }

  private async extractIdFromTestId(locator: Locator, prefix: string): Promise<string> {
    const testId = await locator.getAttribute('data-testid')
    if (!testId || !testId.startsWith(prefix)) {
      throw new Error(`Expected data-testid starting with ${prefix}, got ${testId ?? 'null'}`)
    }
    return testId.slice(prefix.length)
  }

  private async getBoardButtonByName(name: string): Promise<Locator> {
    const boardButton = this.boardButtonByName(name)
    await expect(boardButton).toBeVisible({ timeout: 10_000 })
    return boardButton
  }

  private async getIssueCardByTitle(title: string): Promise<Locator> {
    const card = this.issueCardByTitle(title)
    await expect(card).toBeVisible({ timeout: 10_000 })
    return card
  }

  private async getColumnByName(name: string): Promise<Locator> {
    const column = this.visibleKanbanBoard().locator(KanbanPage.KANBAN_COLUMN).filter({ hasText: name }).first()
    await expect(column).toBeVisible({ timeout: 10_000 })
    return column
  }

  private async getColumnStatusIdByName(name: string): Promise<string> {
    const column = await this.getColumnByName(name)
    const statusId = await column.getAttribute('data-kanban-column-id')
    if (!statusId) {
      throw new Error(`Column ${name} is missing data-kanban-column-id`)
    }
    return statusId
  }

  private async getColumnDropzoneByName(name: string): Promise<Locator> {
    const statusId = await this.getColumnStatusIdByName(name)
    const dropzone = this.visibleKanbanBoard().locator(`[data-testid="kanban-column-dropzone-${statusId}"]`)
    await expect(dropzone).toBeVisible({ timeout: 10_000 })
    return dropzone
  }

  private async rememberBoardIdByName(name: string): Promise<string> {
    const boardButton = await this.getBoardButtonByName(name)
    const boardId = await this.extractIdFromTestId(boardButton, 'kanban-board-')
    this.owner.remember(`boardId:${name}`, boardId)
    this.owner.remember('currentBoardId', boardId)
    return boardId
  }

  private visibleStatusManager(): Locator {
    return this.page.locator(`${KanbanPage.STATUS_MANAGER}:visible`).first()
  }

  private statusRowByName(name: string): Locator {
    return this.visibleStatusManager().locator(KanbanPage.STATUS_ROW).filter({ hasText: name }).first()
  }

  private readSingleColumnTable(table: DataTable): string[] {
    return table.raw().flat().map(value => value.trim()).filter(Boolean)
  }

  private async getVisibleStatusManagerNames(): Promise<string[]> {
    return this.visibleStatusManager().locator(KanbanPage.STATUS_ROW).evaluateAll((elements) => {
      return elements
        .map(element => element.querySelector('[data-testid^="status-name-"]')?.textContent?.trim() ?? '')
        .filter((value): value is string => value.length > 0)
    })
  }

  private async getVisibleColumnNames(): Promise<string[]> {
    return this.visibleKanbanBoard().locator(KanbanPage.KANBAN_COLUMN).evaluateAll((elements) => {
      return elements
        .map(element => element.querySelector('[data-testid^="kanban-column-title-"]')?.textContent?.trim() ?? '')
        .filter((value): value is string => value.length > 0)
    })
  }

  private async dragStatusRowBefore(sourceName: string, targetName: string): Promise<void> {
    const sourceRow = this.statusRowByName(sourceName)
    const targetRow = this.statusRowByName(targetName)
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

    await this.page.mouse.move(startX, startY)
    await this.page.mouse.down()
    await this.page.mouse.move(startX, startY + 18, { steps: 6 })
    await this.page.mouse.move(targetX, targetY, { steps: 18 })
    await this.page.mouse.up()
  }

  private async _dragIssueCardToColumn(title: string, columnName: string): Promise<void> {
    const source = this.issueCardByTitle(title)
    await expect(source).toBeVisible({ timeout: 10_000 })
    const targetDropzone = await this.getColumnDropzoneByName(columnName)

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

    await this.page.mouse.move(startX, startY)
    await this.page.mouse.down()
    // Move enough to activate PointerSensor (distance > 5)
    await this.page.mouse.move(startX + 10, startY, { steps: 5 })
    await this.page.waitForTimeout(100)
    // Move to the target column
    await this.page.mouse.move(targetX, targetY, { steps: 30 })
    await this.page.waitForTimeout(200)
    await this.page.mouse.up()
  }

  async expectSidebarVisible(): Promise<void> {
    await expect(this.page.locator(KanbanPage.KANBAN_SIDEBAR)).toBeVisible({ timeout: 10_000 })
  }

  async expectEmptyBoardText(text: string): Promise<void> {
    await expect(this.page.getByText(text, { exact: false }).first()).toBeVisible({ timeout: 10_000 })
  }

  async open(): Promise<void> {
    const sidebar = this.page.locator(KanbanPage.KANBAN_SIDEBAR)
    if (await sidebar.isVisible().catch(() => false)) {
      return
    }

    // Kanban sidebar is rendered directly in the workspace sidebar — no dedicated nav button.
    // If not visible, the workspace sidebar itself may be collapsed; just wait for it.
    await expect(sidebar).toBeVisible({ timeout: 15_000 })
  }

  async clickNewBoardButton(): Promise<void> {
    const addButton = this.page.locator('[data-testid="kanban-add-board-btn"]')
    await expect(addButton).toBeVisible({ timeout: 10_000 })
    await addButton.click()
    await expect(this.page.locator(KanbanPage.KANBAN_BOARD_INPUT)).toBeVisible({ timeout: 10_000 })
  }

  async enterBoardName(name: string): Promise<void> {
    const input = this.page.locator(KanbanPage.KANBAN_BOARD_INPUT)
    await expect(input).toBeVisible({ timeout: 10_000 })
    await input.fill(name)
    await input.press('Enter')
  }

  async createNamedBoard(name: string): Promise<void> {
    await this.open()
    await this.createBoard(name)

    if (await this.visibleKanbanBoard().locator(KanbanPage.KANBAN_COLUMN).count() === 0) {
      await this.ensureDefaultStatuses()
      return
    }

    await expect(this.visibleKanbanBoard().locator(KanbanPage.KANBAN_COLUMN).first()).toBeVisible({ timeout: 10_000 })
  }

  async createBoardWithDefaultStatuses(name = 'E2E Board'): Promise<void> {
    await this.createNamedBoard(name)
  }

  async expectSidebarBoardVisible(name: string): Promise<void> {
    await expect(this.boardButtonByName(name)).toBeVisible({ timeout: 10_000 })
  }

  async expectSidebarBoardHidden(name: string): Promise<void> {
    await expect(this.boardButtonByName(name)).toHaveCount(0, { timeout: 10_000 })
  }

  async expectBoardVisible(): Promise<void> {
    await expect(this.visibleKanbanBoard()).toBeVisible({ timeout: 10_000 })
  }

  async clickFirstColumnAddButton(): Promise<void> {
    const firstColumn = this.visibleKanbanBoard().locator(KanbanPage.KANBAN_COLUMN).first()
    await expect(firstColumn).toBeVisible({ timeout: 10_000 })
    await firstColumn.hover()

    const addButton = this.visibleKanbanBoard().locator(KanbanPage.KANBAN_COLUMN_ADD).first()
    await expect(addButton).toBeVisible({ timeout: 10_000 })
    await addButton.click({ force: true })
    await expect(this.page.locator(KanbanPage.KANBAN_ISSUE_INPUT)).toBeVisible({ timeout: 10_000 })
  }

  async enterIssueTitle(title: string): Promise<void> {
    const input = this.page.locator(KanbanPage.KANBAN_ISSUE_INPUT)
    await expect(input).toBeVisible({ timeout: 10_000 })
    await input.fill(title)
    await input.press('Enter')
  }

  async expectCardVisible(title: string): Promise<void> {
    await expect(this.issueCardByTitle(title)).toBeVisible({ timeout: 10_000 })
  }

  async expectCardHidden(title: string): Promise<void> {
    await expect(this.issueCardByTitle(title)).toHaveCount(0, { timeout: 10_000 })
  }

  async expectCardPriority(title: string, label: string): Promise<void> {
    const card = await this.getIssueCardByTitle(title)
    await expect(card).toContainText(label, { timeout: 10_000 })
  }

  async createIssueInFirstColumn(title: string): Promise<void> {
    const firstColumn = this.visibleKanbanBoard().locator(KanbanPage.KANBAN_COLUMN).first()
    await expect(firstColumn).toBeVisible({ timeout: 10_000 })
    await firstColumn.hover()

    const addButton = this.visibleKanbanBoard().locator(KanbanPage.KANBAN_COLUMN_ADD).first()
    await expect(addButton).toBeVisible({ timeout: 10_000 })
    await addButton.click({ force: true })

    const input = this.page.locator(KanbanPage.KANBAN_ISSUE_INPUT)
    await expect(input).toBeVisible({ timeout: 10_000 })
    await input.fill(title)
    await input.press('Enter')

    await expect(this.issueCardByTitle(title)).toBeVisible({ timeout: 10_000 })
    // Input may remain for rapid multi-create; dismiss if still open.
    if (await this.page.locator(KanbanPage.KANBAN_ISSUE_INPUT).count() > 0) {
      await this.page.keyboard.press('Escape').catch(() => undefined)
    }
  }

  async openIssueDetail(title: string): Promise<void> {
    const card = this.issueCardByTitle(title)
    await expect(card).toBeVisible({ timeout: 10_000 })
    await card.click()
    await expect(this.page.locator(KanbanPage.ISSUE_DETAIL_PANEL)).toBeVisible({ timeout: 10_000 })
  }

  async openFirstIssueDetail(): Promise<void> {
    const firstCard = this.visibleKanbanBoard().locator(KanbanPage.KANBAN_ISSUE_CARD).first()
    await expect(firstCard).toBeVisible({ timeout: 10_000 })
    await firstCard.click()
    await expect(this.page.locator(KanbanPage.ISSUE_DETAIL_PANEL)).toBeVisible({ timeout: 10_000 })
  }

  async expectIssueDetailVisible(): Promise<void> {
    await expect(this.page.locator(KanbanPage.ISSUE_DETAIL_PANEL)).toBeVisible({ timeout: 10_000 })
  }

  async expectPanelTitle(title: string): Promise<void> {
    await expect(this.page.locator(KanbanPage.ISSUE_TITLE_DISPLAY)).toHaveText(title, { timeout: 10_000 })
  }

  async fillComment(text: string): Promise<void> {
    const textarea = this.page.locator(KanbanPage.ISSUE_COMMENT_INPUT)
    await expect(textarea).toBeVisible({ timeout: 10_000 })
    await textarea.fill(text)
  }

  async clickCommentButton(): Promise<void> {
    const comments = this.page.locator('[data-testid^="comment-"]')
    this.owner.remember('issueCommentCountBeforeSubmit', await comments.count())

    const submitButton = this.page.locator(KanbanPage.ISSUE_COMMENT_SUBMIT)
    await expect(submitButton).toBeEnabled({ timeout: 10_000 })
    await submitButton.click()
  }

  async expectCommentVisible(text: string): Promise<void> {
    const comment = this.page.locator('[data-testid^="comment-"]').filter({ hasText: text })
    await expect(comment).toBeVisible({ timeout: 10_000 })
    await expect(this.page.locator(KanbanPage.ISSUE_COMMENT_INPUT)).toHaveValue('', { timeout: 10_000 })

    const before = this.owner.maybeRecall<number>('issueCommentCountBeforeSubmit')
    if (typeof before === 'number') {
      await expect(this.page.locator('[data-testid^="comment-"]')).toHaveCount(before + 1, { timeout: 10_000 })
    }
  }

  async moveIssueCardToColumn(title: string, columnName: string): Promise<void> {
    // Use status picker in issue detail panel (more reliable than DnD in E2E)
    const card = this.issueCardByTitle(title)
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
  }

  async expectIssueCardInColumn(title: string, columnName: string): Promise<void> {
    const column = await this.getColumnByName(columnName)
    await expect(column.locator(KanbanPage.KANBAN_ISSUE_CARD).filter({ hasText: title })).toBeVisible({ timeout: 10_000 })
  }

  async deleteBoard(name: string): Promise<void> {
    const boardButton = await this.getBoardButtonByName(name)
    const boardId = this.owner.maybeRecall<string>(`boardId:${name}`) ?? await this.rememberBoardIdByName(name)

    await boardButton.hover()
    const trigger = this.page.locator(`[data-testid="kanban-board-menu-trigger-${boardId}"]`)
    await expect(trigger).toBeVisible({ timeout: 10_000 })
    await trigger.click()

    const deleteItem = this.page.locator(`[data-testid="kanban-board-delete-${boardId}"]`)
    await expect(deleteItem).toBeVisible({ timeout: 10_000 })
    await deleteItem.click()
  }

  async renameIssueTitle(title: string): Promise<void> {
    const display = this.page.locator(KanbanPage.ISSUE_TITLE_DISPLAY)
    await expect(display).toBeVisible({ timeout: 10_000 })
    await display.click()

    const input = this.page.locator(KanbanPage.ISSUE_TITLE_INPUT)
    await expect(input).toBeVisible({ timeout: 10_000 })
    await input.fill(title)
    await input.press('Enter')

    await expect(display).toHaveText(title, { timeout: 10_000 })
  }

  async updateIssueDescription(description: string): Promise<void> {
    const editor = this.page.locator(KanbanPage.ISSUE_DESCRIPTION_EDITOR)
    await expect(editor).toBeVisible({ timeout: 10_000 })
    await editor.click()
    await editor.fill(description)
    await this.page.locator(KanbanPage.ISSUE_DETAIL_HEADER).click()
    await expect(editor).toHaveValue(description, { timeout: 10_000 })
  }

  async updateIssuePriority(priority: string): Promise<void> {
    const trigger = this.page.locator(KanbanPage.ISSUE_PRIORITY_TRIGGER)
    await expect(trigger).toBeVisible({ timeout: 10_000 })
    await trigger.click()

    const option = this.page.locator(`[data-testid="issue-priority-option-${priority}"]`)
    await expect(option).toBeVisible({ timeout: 10_000 })
    await option.click()

    await expect(trigger).toContainText(KanbanPage.PRIORITY_LABELS[priority] ?? priority, { timeout: 10_000 })
  }

  async closeIssueDetail(): Promise<void> {
    const closeButton = this.page.locator(KanbanPage.ISSUE_DETAIL_CLOSE_BUTTON)
    await expect(closeButton).toBeVisible({ timeout: 10_000 })
    await closeButton.click()
    await expect(this.page.locator(KanbanPage.ISSUE_DETAIL_PANEL)).toHaveCount(0, { timeout: 10_000 })
    await expect(this.visibleKanbanBoard()).toBeVisible({ timeout: 10_000 })
  }

  async deleteOpenIssue(): Promise<void> {
    const trigger = this.page.locator(KanbanPage.ISSUE_DETAIL_MENU_TRIGGER)
    await expect(trigger).toBeVisible({ timeout: 10_000 })
    await trigger.click()

    const deleteItem = this.page.locator(KanbanPage.ISSUE_DETAIL_DELETE_ISSUE)
    await expect(deleteItem).toBeVisible({ timeout: 10_000 })
    await deleteItem.click()

    await expect(this.page.locator(KanbanPage.ISSUE_DETAIL_PANEL)).toHaveCount(0, { timeout: 10_000 })
  }

  async addSubIssueToOpenIssue(title: string): Promise<void> {
    const panel = this.page.locator(KanbanPage.ISSUE_DETAIL_PANEL)
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
  }

  async addLabelToOpenIssue(label: string): Promise<void> {
    const panel = this.page.locator(KanbanPage.ISSUE_DETAIL_PANEL)
    await expect(panel).toBeVisible({ timeout: 10_000 })

    const trigger = panel.locator('[data-testid="issue-label-add-trigger"]')
    await expect(trigger).toBeVisible({ timeout: 10_000 })
    await trigger.click()

    const input = this.page.locator('[data-testid="issue-label-input"]')
    await expect(input).toBeVisible({ timeout: 10_000 })
    await input.fill(label)
    await input.press('Enter')

    await expect(panel.locator(`[data-testid="issue-label-chip-${label}"]`)).toBeVisible({ timeout: 10_000 })
  }

  async openStatusManager(): Promise<void> {
    const manager = this.visibleStatusManager()
    if (await manager.isVisible().catch(() => false)) {
      return
    }

    const settingsButton = this.page.locator('[data-testid="kanban-status-manager-btn"]')
    await expect(settingsButton).toBeVisible({ timeout: 10_000 })
    await settingsButton.click()
    await expect(manager).toBeVisible({ timeout: 10_000 })
  }

  async closeStatusManager(): Promise<void> {
    const manager = this.visibleStatusManager()
    if (!await manager.isVisible().catch(() => false)) {
      return
    }

    // Wait for any pending DnD / mutation re-renders to settle
    await this.page.waitForTimeout(500)

    const settingsButton = this.page.locator('[data-testid="kanban-status-manager-btn"]')
    await expect(settingsButton).toBeVisible({ timeout: 5000 })
    await settingsButton.click()

    await expect(this.page.locator(`${KanbanPage.STATUS_MANAGER}:visible`)).toHaveCount(0, { timeout: 10_000 })
  }

  async addStatusColumn(name: string): Promise<void> {
    await this.openStatusManager()
    await this.addStatus(name)
  }

  async renameStatusColumn(currentName: string, nextName: string): Promise<void> {
    await this.openStatusManager()

    const row = this.statusRowByName(currentName)
    await expect(row).toBeVisible({ timeout: 10_000 })
    const rowId = await this.extractIdFromTestId(row, 'status-row-')

    const nameLabel = this.page.locator(`[data-testid="status-name-${rowId}"]`)
    await expect(nameLabel).toBeVisible({ timeout: 10_000 })
    await nameLabel.click()

    const input = this.page.locator(`[data-testid="status-input-${rowId}"]`)
    await expect(input).toBeVisible({ timeout: 10_000 })
    await input.fill(nextName)
    await input.press('Enter')

    await expect(this.statusRowByName(nextName)).toBeVisible({ timeout: 10_000 })
  }

  async moveStatusColumnBefore(sourceName: string, targetName: string): Promise<void> {
    await this.openStatusManager()
    await this.dragStatusRowBefore(sourceName, targetName)

    await expect.poll(async () => {
      const names = await this.getVisibleStatusManagerNames()
      return names.indexOf(sourceName) < names.indexOf(targetName)
    }).toBe(true)
  }

  async deleteStatusColumn(name: string): Promise<void> {
    await this.openStatusManager()

    const row = this.statusRowByName(name)
    await expect(row).toBeVisible({ timeout: 10_000 })

    const deleteButton = row.locator('[data-testid^="status-delete-"]').first()
    await expect(deleteButton).toBeVisible({ timeout: 10_000 })
    await deleteButton.click()

    await expect(this.statusRowByName(name)).toHaveCount(0, { timeout: 10_000 })
  }

  async expectColumnOrder(table: DataTable): Promise<void> {
    const expected = this.readSingleColumnTable(table)
    await expect.poll(async () => {
      const visible = await this.getVisibleColumnNames()
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
  }

  async expectSubIssueVisible(title: string): Promise<void> {
    const panel = this.page.locator(KanbanPage.ISSUE_DETAIL_PANEL)
    const list = panel.locator('[data-testid="sub-issues-list"]')
    await expect(list.locator('[data-testid^="sub-issue-"]').filter({ hasText: title })).toBeVisible({ timeout: 10_000 })
  }

  async expectCardLabel(title: string, label: string): Promise<void> {
    const card = await this.getIssueCardByTitle(title)
    await expect(card).toContainText(label, { timeout: 10_000 })
  }

  async search(query: string): Promise<void> {
    const input = this.page.locator(KanbanPage.KANBAN_SEARCH_INPUT)
    await expect(input).toBeVisible({ timeout: 10_000 })
    await input.fill(query)
  }

  async clearSearch(): Promise<void> {
    const input = this.page.locator(KanbanPage.KANBAN_SEARCH_INPUT)
    await expect(input).toBeVisible({ timeout: 10_000 })
    await input.fill('')
  }
}
