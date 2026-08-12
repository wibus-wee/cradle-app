import { readFileSync } from 'node:fs'
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
  objective: string
  primarySessionId: string
}

interface WorkDetail {
  work: { objective: string, acceptanceCriteria: string[] }
  primaryThread: { id: string }
  execution: {
    isIsolated: boolean
    worktreePath: string | null
    worktreeHealth: string | null
  }
  readiness: {
    changedFiles: number
  }
  state: string
  stateSinceAt: number
  stateExplanation: {
    trigger: string
    evidence: string
    authority: string
    nextAction: string
  }
  recovery: {
    level: string
    evidence: string
  }
}

export class WorkPage {
  constructor(private readonly owner: WorkPageOwner) {}

  private get page(): Page {
    return this.owner.page
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

  async fillAcceptanceCriteria(criterion: string): Promise<void> {
    const input = this.page.locator('[data-testid="new-work-acceptance-criteria"]')
    await expect(input).toBeVisible({ timeout: TIMEOUT })
    await input.fill(criterion)
  }

  async start(): Promise<void> {
    const send = this.page.locator('[data-testid="new-work-send-btn"]')
    await expect(send).toBeEnabled({ timeout: TIMEOUT })
    await send.click()
  }

  async expectPersisted(goal: string, sessionId: string): Promise<string> {
    let matchedWorkId: string | null = null
    await expect.poll(async () => {
      const response = await fetch(`${this.owner.params.serverUrl}/works`)
      if (!response.ok) {
        return null
      }
      const works = await response.json() as WorkSummary[]
      const match = works.find(work => work.primarySessionId === sessionId)
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
    expect(detail.state.length).toBeGreaterThan(0)
    expect(detail.stateExplanation.authority.length).toBeGreaterThan(0)
    expect(detail.stateExplanation.evidence.length).toBeGreaterThan(0)
    expect(detail.stateExplanation.nextAction.length).toBeGreaterThan(0)
    expect(detail.recovery.level).not.toBe('unknown')
    expect(detail.recovery.evidence.length).toBeGreaterThan(0)
    expect(readFileSync(join(detail.execution.worktreePath!, 'e2e-work-result.txt'), 'utf8'))
      .toBe('created inside the managed Cradle worktree\n')
    return matchedWorkId
  }

  async expectExplainableState(): Promise<void> {
    await expect(this.page.locator('[data-testid="work-state-badge"]')).toBeVisible({ timeout: TIMEOUT })
    await expect(this.page.locator('[data-testid="work-recovery-badge"]')).toBeVisible({ timeout: TIMEOUT })
    await expect(this.page.locator('[data-testid="work-state-badge"]')).not.toHaveText('')
    await expect(this.page.locator('[data-testid="work-recovery-badge"]')).not.toHaveText('')
  }

  async expectAcceptanceCriterion(workId: string, criterion: string): Promise<void> {
    const response = await fetch(`${this.owner.params.serverUrl}/works/${workId}`)
    expect(response.ok).toBe(true)
    const detail = await response.json() as WorkDetail
    expect(detail.work.acceptanceCriteria).toContain(criterion)
  }

  async expectAttentionDirectAction(workId: string): Promise<void> {
    const nav = this.page.locator('[data-testid="nav-needs-me"]')
    await expect(nav).toBeVisible({ timeout: TIMEOUT })
    await nav.click()
    await expect(this.page.locator('[data-testid="work-attention"]')).toBeVisible({ timeout: TIMEOUT })
    const item = this.page.locator(`[data-testid="attention-item-${workId}"]`)
    await expect(item).toBeVisible({ timeout: TIMEOUT })
    await item.locator('button').first().click()
    await expect(this.page).toHaveURL(new RegExp(`/work/${workId}$`), { timeout: TIMEOUT })
    await expect(this.page.locator('[data-testid="work-state-badge"]')).toBeVisible({ timeout: TIMEOUT })
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
