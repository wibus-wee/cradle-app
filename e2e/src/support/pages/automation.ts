import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'

import { E2E_ANTHROPIC_PROFILE_ID } from '../providers'
import { E2E_ANTHROPIC_MODEL } from '../scenarios/anthropic'
import type { WorkspaceFixture } from './workspace'

export const AUTOMATION_REPORT = '自动化审阅发现了一项需要处理的问题。'
export const AUTOMATION_SUMMARY = '需要处理一项审阅问题'

const DEFINITION_TITLE = '每日工作区审阅'
const ARTIFACT_NAME = 'automation-review.md'
const TIMEOUT = 30_000
const DEFINITION_ID_KEY = 'automation.definition-id'
const RUN_ID_KEY = 'automation.run-id'
const SESSION_ID_KEY = 'automation.session-id'

interface AutomationPageOwner {
  page: Page
  params: { serverUrl: string }
  remember: <T>(key: string, value: T) => void
  recall: <T>(key: string) => T
  workspacePage: { recallCurrentWorkspace: () => WorkspaceFixture }
  chat: {
    openSession: (sessionId: string) => Promise<void>
    expectAssistantContains: (text: string | RegExp, timeout?: number) => Promise<void>
  }
}

interface ServerWorkspace { id: string, locator: { path: string } }
interface AutomationDefinition { id: string }
interface AutomationRun {
  id: string
  status: string
  chatSessionId: string | null
  triageStatus: string | null
}

export class AutomationPage {
  constructor(private readonly owner: AutomationPageOwner) {}

  private get page(): Page {
    return this.owner.page
  }

  private dashboard(): Locator {
    return this.page.locator('[data-testid="automation-dashboard"]')
  }

  private definitionRow(): Locator {
    return this.dashboard().getByRole('button', { name: new RegExp(DEFINITION_TITLE) }).last()
  }

  private async selectDefinition(): Promise<void> {
    await expect(this.definitionRow()).toBeVisible({ timeout: TIMEOUT })
    await this.definitionRow().click()
    await expect(this.dashboard().getByRole('heading', { name: DEFINITION_TITLE })).toBeVisible({ timeout: TIMEOUT })
  }

  private async openTab(name: 'Runs' | 'Artifacts'): Promise<void> {
    await this.dashboard().getByRole('button', { name, exact: true }).click()
  }

  async seedDefinition(): Promise<void> {
    const fixture = this.owner.workspacePage.recallCurrentWorkspace()
    const workspacesResponse = await fetch(`${this.owner.params.serverUrl}/workspaces`)
    expect(workspacesResponse.ok).toBe(true)
    const workspaces = await workspacesResponse.json() as ServerWorkspace[]
    const workspace = workspaces.find(candidate => candidate.locator.path === fixture.dir)
    if (!workspace) {
      throw new Error(`Current workspace was not returned by the server: ${fixture.dir}`)
    }

    const response = await fetch(`${this.owner.params.serverUrl}/automations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: DEFINITION_TITLE,
        description: 'E2E Agent report lifecycle fixture',
        workspaceId: workspace.id,
        enabled: true,
        trigger: { type: 'rrule', rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0;BYSECOND=0', timezone: 'UTC', misfirePolicy: 'skip' },
        recipe: {
          kind: 'agent_task',
          prompt: '审阅当前工作区并生成一份简短报告。',
          inputs: [{ type: 'text', name: 'scope', content: 'Only report actionable findings.' }],
          artifactRequests: [{ kind: 'markdown', name: ARTIFACT_NAME }],
          providerTargetId: E2E_ANTHROPIC_PROFILE_ID,
          runtimeKind: 'claude-agent',
          modelId: E2E_ANTHROPIC_MODEL,
          sessionPolicy: 'new',
          isolationPolicy: 'workspace',
          completionPolicy: { stopWhen: 'agent_complete', noFindingsBehavior: 'archive' },
        },
        createdByKind: 'user',
      }),
    })
    if (!response.ok) {
      throw new Error(`Failed to seed Automation: ${response.status} ${await response.text()}`)
    }
    this.owner.remember(DEFINITION_ID_KEY, (await response.json() as AutomationDefinition).id)
    await this.page.reload({ waitUntil: 'domcontentloaded' })
  }

  async openAndSelectDefinition(): Promise<void> {
    await this.page.locator('[data-testid="nav-automation"]').click()
    await expect(this.dashboard()).toHaveAttribute('data-automation-ready', 'true', { timeout: TIMEOUT })
    await this.selectDefinition()
  }

  async runNow(): Promise<void> {
    const definitionId = this.owner.recall<string>(DEFINITION_ID_KEY)
    const responsePromise = this.page.waitForResponse(
      response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === `/automations/${definitionId}/run`,
      { timeout: TIMEOUT * 2 },
    )
    const button = this.dashboard().getByRole('button', { name: 'Run now', exact: true }).filter({ hasText: 'Run now' })
    await expect(button).toBeEnabled({ timeout: TIMEOUT })
    await button.click()

    const response = await responsePromise
    expect(response.ok()).toBe(true)
    const run = await response.json() as AutomationRun
    expect(run).toMatchObject({ status: 'complete', triageStatus: 'unread' })
    expect(run.chatSessionId).not.toBeNull()
    this.owner.remember(RUN_ID_KEY, run.id)
    this.owner.remember(SESSION_ID_KEY, run.chatSessionId!)
  }

  async expectCompletedRunInTriage(): Promise<void> {
    const triage = this.dashboard().locator('aside').first()
    await expect(triage).toContainText(DEFINITION_TITLE, { timeout: TIMEOUT })
    await expect(triage).toContainText(AUTOMATION_SUMMARY, { timeout: TIMEOUT })
    await this.openTab('Runs')
    const run = this.dashboard().getByText(this.owner.recall<string>(RUN_ID_KEY), { exact: true }).locator('..')
    await expect(run).toContainText('complete', { timeout: TIMEOUT })
    await expect(run).toContainText(AUTOMATION_SUMMARY, { timeout: TIMEOUT })
  }

  async expectArtifact(): Promise<void> {
    await this.openTab('Artifacts')
    await expect(this.dashboard().getByRole('button', { name: new RegExp(ARTIFACT_NAME) })).toBeVisible({ timeout: TIMEOUT })
    await expect(this.dashboard().locator('main')).toContainText(AUTOMATION_REPORT, { timeout: TIMEOUT })
  }

  async resolveRun(): Promise<void> {
    await this.openTab('Runs')
    const runId = this.owner.recall<string>(RUN_ID_KEY)
    const run = this.dashboard().getByText(runId, { exact: true }).locator('..')
    await run.hover()
    const responsePromise = this.page.waitForResponse(response =>
      response.request().method() === 'PATCH'
      && new URL(response.url()).pathname.endsWith(`/runs/${runId}/triage`))
    await run.getByRole('button', { name: 'Resolve', exact: true }).click()
    expect((await responsePromise).ok()).toBe(true)
  }

  async expectTriageEmpty(): Promise<void> {
    const triage = this.dashboard().locator('aside').first()
    await expect(triage).not.toContainText(AUTOMATION_SUMMARY, { timeout: TIMEOUT })
    await expect(triage).toContainText('No unread runs', { timeout: TIMEOUT })
  }

  async expectPersistedRunAndArtifact(): Promise<void> {
    await expect(this.dashboard()).toHaveAttribute('data-automation-ready', 'true', { timeout: TIMEOUT })
    await this.selectDefinition()
    await this.openTab('Runs')
    await expect(this.dashboard().getByText(this.owner.recall<string>(RUN_ID_KEY), { exact: true })).toBeVisible({ timeout: TIMEOUT })
    await expect(this.dashboard().locator('main')).toContainText(AUTOMATION_SUMMARY, { timeout: TIMEOUT })
    await this.expectArtifact()
  }

  async openLinkedSession(): Promise<void> {
    const sessionId = this.owner.recall<string>(SESSION_ID_KEY)
    await expect(this.page.locator(`[data-testid="session-title-${sessionId}"]`))
      .toHaveText(`Automation: ${DEFINITION_TITLE}`, { timeout: TIMEOUT })
    await this.owner.chat.openSession(sessionId)
  }

  async expectLinkedSessionReport(): Promise<void> {
    await this.owner.chat.expectAssistantContains(AUTOMATION_REPORT, TIMEOUT)
    await this.owner.chat.expectAssistantContains(AUTOMATION_SUMMARY, TIMEOUT)
  }
}
