import type { Locator, Page, Response } from '@playwright/test'
import { expect } from '@playwright/test'

const SESSION_GROUP_TIMEOUT = 15_000

export class SessionGroupsPage {
  constructor(private readonly page: Page) {}

  group(title: string): Locator {
    return this.page
      .locator('div[data-testid^="session-group-"]')
      .filter({ has: this.page.getByText(title, { exact: true }) })
      .first()
  }

  async createFromOpenSessionMenu(title: string): Promise<void> {
    const createItem = this.page.getByRole('menuitem', { name: /Create new group/ })
    await expect(createItem).toBeVisible({ timeout: SESSION_GROUP_TIMEOUT })
    await createItem.click()

    const dialog = this.page.getByRole('dialog').filter({ hasText: 'New session group' })
    await expect(dialog).toBeVisible({ timeout: SESSION_GROUP_TIMEOUT })
    await dialog.getByRole('textbox', { name: 'Title' }).fill(title)

    const responsePromise = this.waitForMutation('POST')
    await dialog.getByRole('button', { name: 'Create', exact: true }).click()
    await this.expectSuccessfulMutation(responsePromise)
    await expect(dialog).toBeHidden({ timeout: SESSION_GROUP_TIMEOUT })
    await expect(this.group(title)).toBeVisible({ timeout: SESSION_GROUP_TIMEOUT })
  }

  async expectCollapsed(title: string, sessionCount: number): Promise<void> {
    const group = this.group(title)
    await expect(group).toBeVisible({ timeout: SESSION_GROUP_TIMEOUT })
    const toggle = group.locator('[data-testid^="session-group-toggle-"]')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(toggle.locator('span').last()).toHaveText(String(sessionCount))
  }

  async expand(title: string): Promise<void> {
    const toggle = this.group(title).locator('[data-testid^="session-group-toggle-"]')
    await expect(toggle).toBeVisible({ timeout: SESSION_GROUP_TIMEOUT })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  }

  async expectExpandedWithMember(title: string, sessionId: string, sessionCount: number): Promise<void> {
    const group = this.group(title)
    await expect(group).toBeVisible({ timeout: SESSION_GROUP_TIMEOUT })
    const toggle = group.locator('[data-testid^="session-group-toggle-"]')
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(toggle.locator('span').last()).toHaveText(String(sessionCount))
    await expect(group.locator(`[data-testid="session-item-${sessionId}"]`)).toBeVisible({
      timeout: SESSION_GROUP_TIMEOUT,
    })
  }

  async rename(currentTitle: string, nextTitle: string): Promise<void> {
    const group = this.group(currentTitle)
    await this.openGroupMenu(group)
    await this.page.getByRole('menuitem', { name: 'Rename group', exact: true }).click()

    const dialog = this.page.getByRole('dialog').filter({ hasText: 'Rename session group' })
    await expect(dialog).toBeVisible({ timeout: SESSION_GROUP_TIMEOUT })
    const input = dialog.getByRole('textbox', { name: 'Title' })
    await expect(input).toHaveValue(currentTitle)
    await input.fill(nextTitle)

    const responsePromise = this.waitForMutation('PATCH')
    await dialog.getByRole('button', { name: 'Rename', exact: true }).click()
    await this.expectSuccessfulMutation(responsePromise)
    await expect(dialog).toBeHidden({ timeout: SESSION_GROUP_TIMEOUT })
    await expect(this.group(nextTitle)).toBeVisible({ timeout: SESSION_GROUP_TIMEOUT })
    await expect(this.group(currentTitle)).toHaveCount(0)
  }

  async remove(title: string): Promise<void> {
    const group = this.group(title)
    await this.openGroupMenu(group)
    const responsePromise = this.waitForMutation('DELETE')
    await this.page.getByRole('menuitem', { name: 'Delete group', exact: true }).click()
    await this.expectSuccessfulMutation(responsePromise)
    await expect(this.group(title)).toHaveCount(0, { timeout: SESSION_GROUP_TIMEOUT })
  }

  async expectAbsent(title: string): Promise<void> {
    await expect(this.group(title)).toHaveCount(0, { timeout: SESSION_GROUP_TIMEOUT })
  }

  async expectSessionUngrouped(sessionId: string): Promise<void> {
    const session = this.page.locator(`[data-testid="session-item-${sessionId}"]`)
    await expect(session).toBeVisible({ timeout: SESSION_GROUP_TIMEOUT })
    await expect(
      this.page.locator('div[data-testid^="session-group-"]').locator(`[data-testid="session-item-${sessionId}"]`),
    ).toHaveCount(0)
  }

  private async openGroupMenu(group: Locator): Promise<void> {
    await expect(group).toBeVisible({ timeout: SESSION_GROUP_TIMEOUT })
    await group.hover()
    const menu = group.locator('[data-testid^="session-group-menu-"]')
    await expect(menu).toBeVisible({ timeout: SESSION_GROUP_TIMEOUT })
    await menu.click()
  }

  private waitForMutation(method: 'POST' | 'PATCH' | 'DELETE'): Promise<Response> {
    return this.page.waitForResponse((response) => {
      const pathname = new URL(response.url()).pathname
      return response.request().method() === method
        && (pathname === '/session-groups' || pathname.startsWith('/session-groups/'))
    })
  }

  private async expectSuccessfulMutation(responsePromise: Promise<Response>): Promise<void> {
    const response = await responsePromise
    expect(response.ok(), await response.text()).toBe(true)
  }
}
