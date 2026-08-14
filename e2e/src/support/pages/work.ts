import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'

import { fillPromptEditor } from '../ui'

const TIMEOUT = 40_000

interface WorkPageOwner {
  page: Page
  params: { serverUrl: string }
}

interface WorkSummary {
  id: string
  linkedIssueId: string | null
  objective: string
  primarySessionId: string
}

interface WorkListPage {
  items: WorkSummary[]
  nextCursor: string | null
}

interface WorkDetail {
  work: { objective: string }
  primaryThread: { id: string }
  execution: {
    isIsolated: boolean
    worktreePath: string | null
    worktreeHealth: string | null
  }
  readiness: {
    clean: boolean
    changedFiles: number
  }
}

export class WorkPage {
  constructor(private readonly owner: WorkPageOwner) {}

  private get page(): Page {
    return this.owner.page
  }

  private async findWork(
    predicate: (work: WorkSummary) => boolean,
  ): Promise<WorkSummary | null> {
    let cursor: string | null = null
    const seenCursors = new Set<string>()

    for (;;) {
      const serverUrl = this.owner.params.serverUrl.replace(/\/$/, '')
      const url = new URL(`${serverUrl}/works`)
      url.searchParams.set('limit', '200')
      if (cursor) {
        url.searchParams.set('cursor', cursor)
      }

      const response = await fetch(url)
      if (!response.ok) {
        return null
      }

      const page = await response.json() as WorkListPage
      const match = page.items.find(predicate)
      if (match) {
        return match
      }

      const nextCursor = page.nextCursor
      if (!nextCursor || seenCursors.has(nextCursor)) {
        return null
      }
      seenCursors.add(nextCursor)
      cursor = nextCursor
    }
  }

  root(): Locator {
    return this.page.locator('[data-testid="new-work-page"]')
  }

  async open(): Promise<void> {
    const nav = this.page.locator('[data-testid="nav-new-work"]')
    await expect(nav).toBeVisible({ timeout: TIMEOUT })
    await nav.click()
    await expect(this.root()).toBeVisible({ timeout: TIMEOUT })
  }

  async selectFirstWorkspace(): Promise<void> {
    const selector = this.page.locator('[data-testid="new-work-workspace-selector"]')
    await expect(selector).toBeVisible({ timeout: TIMEOUT })
    await selector.click()
    const option = this.page.locator('[data-testid^="new-work-workspace-option-"]').first()
    await expect(option).toBeVisible({ timeout: TIMEOUT })
    const label = (await option.textContent())?.trim()
    if (!label) {
      throw new Error('New Work workspace option did not expose a label')
    }
    await option.click()
    await expect(selector).toContainText(label, { timeout: TIMEOUT })
  }

  async fillGoal(goal: string): Promise<void> {
    await fillPromptEditor(this.page.locator('[data-testid="new-work-textarea"]'), goal)
  }

  async start(): Promise<void> {
    const send = this.page.locator('[data-testid="new-work-send-btn"]')
    await expect(send).toBeEnabled({ timeout: TIMEOUT })
    await send.click()
  }

  async expectPersisted(goal: string, sessionId: string): Promise<void> {
    let matchedWorkId: string | null = null
    await expect.poll(async () => {
      const match = await this.findWork(work => work.primarySessionId === sessionId)
      matchedWorkId = match?.objective === goal ? match.id : null
      return matchedWorkId
    }, { timeout: TIMEOUT }).not.toBeNull()

    if (!matchedWorkId) {
      throw new Error(`Work for session ${sessionId} was not persisted`)
    }
    const response = await fetch(`${this.owner.params.serverUrl}/works/${matchedWorkId}`)
    expect(response.ok).toBe(true)
    const detail = await response.json() as WorkDetail
    expect(detail.work.objective).toBe(goal)
    expect(detail.primaryThread.id).toBe(sessionId)
    expect(detail.execution).toMatchObject({
      isIsolated: true,
      worktreeHealth: 'ok',
    })
    expect(detail.readiness.changedFiles).toBeGreaterThanOrEqual(1)
    expect(detail.execution.worktreePath).not.toBeNull()
    expect(readFileSync(join(detail.execution.worktreePath!, 'e2e-work-result.txt'), 'utf8'))
      .toBe('created inside the managed Cradle worktree\n')
  }

  async expectIssueDelegationWork(input: {
    issueTitle: string
    sessionId: string
    fileName: string
    fileContent: string
  }): Promise<void> {
    let matchedWorkId: string | null = null
    await expect.poll(async () => {
      const match = await this.findWork(work =>
        work.primarySessionId === input.sessionId
        && work.linkedIssueId !== null
        && work.objective.includes(`# Cradle Issue: ${input.issueTitle}`))
      matchedWorkId = match?.id ?? null
      return matchedWorkId
    }, { timeout: TIMEOUT }).not.toBeNull()

    if (!matchedWorkId) {
      throw new Error(`Isolated Work for Issue ${input.issueTitle} was not persisted`)
    }
    const response = await fetch(`${this.owner.params.serverUrl}/works/${matchedWorkId}`)
    expect(response.ok).toBe(true)
    const detail = await response.json() as WorkDetail
    expect(detail.execution).toMatchObject({
      isIsolated: true,
      worktreeHealth: 'ok',
    })
    expect(detail.readiness.changedFiles).toBeGreaterThanOrEqual(1)
    const worktreePath = detail.execution.worktreePath
    if (!worktreePath) {
      throw new Error(`Isolated Work ${matchedWorkId} lost its worktree binding`)
    }
    expect(readFileSync(join(worktreePath, input.fileName), 'utf8'))
      .toBe(input.fileContent)

    await this.openRuntimePanel()
    const panel = this.page.locator('[data-testid="right-aside-panel-runtime"]')
    await expect(panel).toContainText('Work')
    await expect(panel).toContainText(`Issue: ${input.issueTitle}`)
  }

  async expectRetainedCanceledIssueWork(input: {
    issueTitle: string
    sessionId: string
  }): Promise<void> {
    const work = await this.findWork(candidate =>
      candidate.primarySessionId === input.sessionId
      && candidate.linkedIssueId !== null
      && candidate.objective.includes(`# Cradle Issue: ${input.issueTitle}`))
    if (!work) {
      throw new Error(`Canceled isolated Work for Issue ${input.issueTitle} was not retained`)
    }

    const detailResponse = await fetch(`${this.owner.params.serverUrl}/works/${work.id}`)
    expect(detailResponse.ok).toBe(true)
    const detail = await detailResponse.json() as WorkDetail
    expect(detail.execution).toMatchObject({
      isIsolated: true,
      worktreeHealth: 'ok',
    })
    expect(detail.readiness).toMatchObject({ clean: true, changedFiles: 0 })
    const worktreePath = detail.execution.worktreePath
    if (!worktreePath) {
      throw new Error(`Canceled isolated Work ${work.id} lost its worktree binding`)
    }
    expect(existsSync(worktreePath)).toBe(true)

    await this.openRuntimePanel()
    const panel = this.page.locator('[data-testid="right-aside-panel-runtime"]')
    await expect(panel).toContainText('Work')
    await expect(panel).toContainText(`Issue: ${input.issueTitle}`)
  }

  async openRuntimePanel(): Promise<void> {
    const aside = this.page.locator('[data-testid="right-aside"][data-visible]')
    if (await aside.getAttribute('data-visible') !== 'true') {
      await this.page.locator('[data-testid="app-header-aside-toggle"]').click()
    }
    await expect(aside).toHaveAttribute('data-visible', 'true', { timeout: TIMEOUT })
    const runtimeTab = this.page.locator('[data-testid="right-aside-tab-runtime"]')
    await expect(runtimeTab).toBeVisible({ timeout: TIMEOUT })
    await runtimeTab.click()
    await expect(this.page.locator('[data-testid="right-aside-panel-runtime"]')).toBeVisible({ timeout: TIMEOUT })
  }
}
