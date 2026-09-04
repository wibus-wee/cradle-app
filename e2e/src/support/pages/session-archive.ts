import type { Locator, Response } from '@playwright/test'
import { expect } from '@playwright/test'

import type {
  PostSessionsByIdArchiveData,
  PostSessionsByIdArchiveResponse,
} from '../../../../apps/web/src/api-gen/types.gen'
import type { CradleWorld } from '../world'

const ARCHIVE_TIMEOUT = 15_000
const ARCHIVE_TARGET_STATE = 'session-archive.target'

interface ArchiveTarget {
  id: string
  title: string
}

export class SessionArchivePage {
  constructor(private readonly world: CradleWorld) {}

  private get page() {
    return this.world.page
  }

  private archivedSessions(): Locator {
    return this.page.locator('[data-testid="chat-archived-sessions"]')
  }

  private searchInput(): Locator {
    return this.archivedSessions().getByRole('searchbox', { name: 'Search archived sessions...' })
  }

  private target(): ArchiveTarget {
    return this.world.recall<ArchiveTarget>(ARCHIVE_TARGET_STATE)
  }

  async archiveCurrent(title: string): Promise<void> {
    const sessionId = await this.world.chat.sessionId()
    this.world.remember(ARCHIVE_TARGET_STATE, { id: sessionId, title } satisfies ArchiveTarget)
    await this.world.chat.openSessionMenu(sessionId)
    const responsePromise = this.waitForArchiveMutation(sessionId)
    await this.world.chat.clickSessionMenuAction(sessionId, 'archive')
    await this.expectArchiveResponse(await responsePromise, sessionId, true)
    await expect(this.world.chat.sessionItem(sessionId)).toBeHidden({ timeout: ARCHIVE_TIMEOUT })
  }

  async expectReady(): Promise<void> {
    await expect(this.page.locator('[data-testid="chat-settings"]')).toBeVisible({ timeout: ARCHIVE_TIMEOUT })
    await expect(this.archivedSessions()).toBeVisible({ timeout: ARCHIVE_TIMEOUT })
  }

  async expectAbsentFromSidebar(): Promise<void> {
    await expect(this.world.chat.sessionItem(this.target().id)).toBeHidden({ timeout: ARCHIVE_TIMEOUT })
  }

  async expectArchived(title: string): Promise<void> {
    await this.expectReady()
    expect(this.target().title).toBe(title)
    await expect(this.archivedSessions().getByText(title, { exact: true })).toBeVisible({ timeout: ARCHIVE_TIMEOUT })
    await expect(this.archivedSessions().getByRole('button', { name: `Restore ${title}`, exact: true }))
      .toBeEnabled({ timeout: ARCHIVE_TIMEOUT })
  }

  async search(query: string): Promise<void> {
    await this.expectReady()
    await this.searchInput().fill(query)
    await expect(this.searchInput()).toHaveValue(query)
  }

  async expectNoMatches(): Promise<void> {
    await expect(this.archivedSessions().getByText('No archived sessions match your search.', { exact: true }))
      .toBeVisible({ timeout: ARCHIVE_TIMEOUT })
  }

  async restore(title: string): Promise<void> {
    await this.expectReady()
    const { id: sessionId, title: targetTitle } = this.target()
    expect(targetTitle).toBe(title)
    const responsePromise = this.waitForArchiveMutation(sessionId)
    await this.archivedSessions().getByRole('button', { name: `Restore ${title}`, exact: true }).click()
    await this.expectArchiveResponse(await responsePromise, sessionId, false)
    await expect(this.archivedSessions().getByText(title, { exact: true })).toBeHidden({ timeout: ARCHIVE_TIMEOUT })
  }

  async expectEmpty(): Promise<void> {
    await expect(this.archivedSessions().getByText('No archived sessions.', { exact: true }))
      .toBeVisible({ timeout: ARCHIVE_TIMEOUT })
  }

  async expectRestoredInSidebar(): Promise<void> {
    await this.world.chat.waitForSessionInSidebar(this.target().id, ARCHIVE_TIMEOUT)
  }

  async openRestored(): Promise<void> {
    await this.world.chat.openSession(this.target().id)
  }

  private waitForArchiveMutation(sessionId: string): Promise<Response> {
    return this.page.waitForResponse((response) => {
      return response.request().method() === 'POST'
        && new URL(response.url()).pathname === `/sessions/${sessionId}/archive`
    }, { timeout: ARCHIVE_TIMEOUT })
  }

  private async expectArchiveResponse(
    response: Response,
    sessionId: string,
    archived: boolean,
  ): Promise<void> {
    expect(response.ok()).toBe(true)
    const requestBody: PostSessionsByIdArchiveData['body'] = response.request().postDataJSON()
    expect(requestBody).toEqual({ archived })

    const updated: PostSessionsByIdArchiveResponse = await response.json()
    expect(updated.id).toBe(sessionId)
    if (archived) {
      expect(typeof updated.archivedAt).toBe('number')
    }
    else {
      expect(updated.archivedAt).toBeNull()
    }
  }
}
