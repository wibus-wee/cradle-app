import type { Locator, Response } from '@playwright/test'
import { expect } from '@playwright/test'

import type { PostAcpAgentsResponse } from '../../../../apps/web/src/api-gen/types.gen'
import type { CradleWorld } from '../world'

const ACP_RUNTIME_TIMEOUT = 20_000
const ACP_AGENT_ID_STATE = 'agent-runtimes.local-agent-id'
const INITIAL_NAME = 'Journey 12 Local ACP'
const UPDATED_NAME = 'Journey 12 Local ACP Updated'

const INITIAL_CONFIG = {
  name: INITIAL_NAME,
  distributionType: 'command',
  cmd: 'node',
  args: ['--stdio', '--log-level=debug'],
  env: {
    LOG_LEVEL: 'debug',
    TRACE_ID: 'journey-12',
    EMPTY_ALLOWED: '',
  },
} as const

const UPDATED_CONFIG = {
  name: UPDATED_NAME,
  distributionType: 'command',
  cmd: 'node',
  args: ['--stdio', '--trace-warnings'],
  env: {
    LOG_LEVEL: 'info',
    TRACE_ID: 'journey-12-updated',
    EMPTY_ALLOWED: '',
  },
} as const

export class AgentRuntimesPage {
  constructor(private readonly world: CradleWorld) {}

  private get page() {
    return this.world.page
  }

  private settings(): Locator {
    return this.page.locator('[data-testid="runtimes-settings"]')
  }

  private localAgentView(): Locator {
    const views = this.settings().locator('[data-testid="acp-local-agent-view"]')
    const agentId = this.world.maybeRecall<string>(ACP_AGENT_ID_STATE)
    return agentId ? views.filter({ hasText: agentId }) : views
  }

  private nameInput(): Locator {
    return this.localAgentView().locator('[data-testid="acp-local-name"]')
  }

  private commandInput(): Locator {
    return this.localAgentView().locator('[data-testid="acp-local-command"]')
  }

  private argumentsInput(): Locator {
    return this.localAgentView().locator('[data-testid="acp-local-arguments"]')
  }

  private environmentInput(): Locator {
    return this.localAgentView().locator('[data-testid="acp-local-environment"]')
  }

  private saveButton(): Locator {
    return this.localAgentView().locator('[data-testid="acp-local-save"]')
  }

  private agentRow(): Locator {
    const agentId = this.world.recall<string>(ACP_AGENT_ID_STATE)
    return this.settings().locator(`[data-testid=${JSON.stringify(`acp-local-row-${agentId}`)}]`)
  }

  async expectReady(): Promise<void> {
    await expect(this.settings()).toBeVisible({ timeout: ACP_RUNTIME_TIMEOUT })
    await expect(this.settings().locator('[data-testid="acp-local-add"]')).toBeVisible({ timeout: ACP_RUNTIME_TIMEOUT })
    await expect(this.settings().locator('[data-testid="runtimes-list"]')).toBeVisible({ timeout: ACP_RUNTIME_TIMEOUT })
  }

  async startAddingLocalAgent(): Promise<void> {
    await this.settings().locator('[data-testid="acp-local-add"]').click()
    await expect(this.localAgentView()).toBeVisible({ timeout: ACP_RUNTIME_TIMEOUT })
    await expect(this.localAgentView().getByRole('heading', { name: 'Add local ACP agent', exact: true }))
      .toBeVisible({ timeout: ACP_RUNTIME_TIMEOUT })
  }

  async enterInvalidConfig(): Promise<void> {
    await this.nameInput().fill(`  ${INITIAL_NAME}  `)
    await this.commandInput().fill('  node  ')
    await this.argumentsInput().fill('  --stdio  \n\n--log-level=debug  ')
    await this.environmentInput().fill('LOG_LEVEL=debug\ninvalid-line\nTRACE_ID=journey-12')
  }

  async expectInvalidEnvironment(): Promise<void> {
    await expect(this.environmentInput()).toHaveAttribute('aria-invalid', 'true')
    await expect(this.localAgentView().getByRole('alert')).toHaveText('Invalid environment lines: 2')
    await expect(this.saveButton()).toBeDisabled()
  }

  async correctEnvironmentAndCreate(): Promise<void> {
    await this.environmentInput().fill(' LOG_LEVEL=debug \n\nTRACE_ID=journey-12\nEMPTY_ALLOWED=')
    await expect(this.environmentInput()).not.toHaveAttribute('aria-invalid', 'true')
    await expect(this.saveButton()).toBeEnabled()

    const responsePromise = this.waitForMutation('POST', '/acp/agents')
    await this.saveButton().click()
    const response = await this.expectSuccessfulMutation(responsePromise)
    expect(response.request().postDataJSON()).toEqual(INITIAL_CONFIG)

    const created: PostAcpAgentsResponse = await response.json()
    expect(created).toMatchObject({
      ...INITIAL_CONFIG,
      args: JSON.stringify(INITIAL_CONFIG.args),
      env: JSON.stringify(INITIAL_CONFIG.env),
      source: 'local',
      status: 'installed',
    })
    expect(created.id).toMatch(/^local-journey-12-local-acp-[a-f0-9]{6}$/)
    this.world.remember(ACP_AGENT_ID_STATE, created.id)
  }

  async expectCreated(): Promise<void> {
    await this.expectToast(`Added ${INITIAL_NAME}`)
    await expect(this.agentRow()).toContainText(INITIAL_NAME, { timeout: ACP_RUNTIME_TIMEOUT })
    await this.expectConfig(INITIAL_CONFIG)
  }

  async selectCreated(): Promise<void> {
    await expect(this.agentRow()).toContainText(INITIAL_NAME, { timeout: ACP_RUNTIME_TIMEOUT })
    await this.agentRow().click()
    await expect(this.localAgentView()).toBeVisible({ timeout: ACP_RUNTIME_TIMEOUT })
  }

  async selectUpdated(): Promise<void> {
    await expect(this.agentRow()).toContainText(UPDATED_NAME, { timeout: ACP_RUNTIME_TIMEOUT })
    await this.agentRow().click()
    await expect(this.localAgentView()).toBeVisible({ timeout: ACP_RUNTIME_TIMEOUT })
  }

  async expectInitialConfig(): Promise<void> {
    await this.expectConfig(INITIAL_CONFIG)
  }

  async updateConfig(): Promise<void> {
    await this.nameInput().fill(` ${UPDATED_NAME} `)
    await this.argumentsInput().fill(' --stdio \n\n--trace-warnings ')
    await this.environmentInput().fill(' LOG_LEVEL=info \nTRACE_ID=journey-12-updated\nEMPTY_ALLOWED=')
    await expect(this.saveButton()).toBeEnabled()

    const agentId = this.world.recall<string>(ACP_AGENT_ID_STATE)
    const responsePromise = this.waitForMutation('PATCH', `/acp/agents/${agentId}/launch-config`)
    await this.saveButton().click()
    const response = await this.expectSuccessfulMutation(responsePromise)
    expect(response.request().postDataJSON()).toEqual(UPDATED_CONFIG)
    expect(await response.json()).toMatchObject({
      ...UPDATED_CONFIG,
      args: JSON.stringify(UPDATED_CONFIG.args),
      env: JSON.stringify(UPDATED_CONFIG.env),
      id: agentId,
      source: 'local',
      status: 'installed',
    })
  }

  async expectUpdated(): Promise<void> {
    await this.expectToast(`Saved ${UPDATED_NAME}`)
    await expect(this.agentRow()).toContainText(UPDATED_NAME, { timeout: ACP_RUNTIME_TIMEOUT })
  }

  async expectUpdatedConfig(): Promise<void> {
    await this.expectConfig(UPDATED_CONFIG)
  }

  async deleteAgent(): Promise<void> {
    const agentId = this.world.recall<string>(ACP_AGENT_ID_STATE)
    await this.localAgentView().getByRole('button', { name: 'Delete', exact: true }).click()
    const confirmation = this.page.locator('[data-testid="acp-local-delete-confirm"]')
    await expect(confirmation).toBeVisible({ timeout: ACP_RUNTIME_TIMEOUT })

    const responsePromise = this.waitForMutation('DELETE', `/acp/agents/${agentId}`)
    await confirmation.click()
    const response = await this.expectSuccessfulMutation(responsePromise)
    expect(await response.json()).toEqual({ ok: true })
  }

  async expectDeleted(savedFeedback: boolean): Promise<void> {
    if (savedFeedback) {
      await this.expectToast(`Deleted ${UPDATED_NAME}`)
    }
    await expect(this.agentRow()).toHaveCount(0)
    await expect(this.settings().getByText(UPDATED_NAME, { exact: true })).toHaveCount(0)
  }

  private async expectConfig(config: typeof INITIAL_CONFIG | typeof UPDATED_CONFIG): Promise<void> {
    await expect(this.nameInput()).toHaveValue(config.name, { timeout: ACP_RUNTIME_TIMEOUT })
    await expect(this.commandInput()).toHaveValue(config.cmd)
    await expect(this.argumentsInput()).toHaveValue(config.args.join('\n'))
    await expect(this.environmentInput()).toHaveValue(
      Object.entries(config.env).map(([key, value]) => `${key}=${value}`).join('\n'),
    )
    await expect(this.saveButton()).toBeDisabled()
  }

  private waitForMutation(method: 'POST' | 'PATCH' | 'DELETE', pathname: string): Promise<Response> {
    return this.page.waitForResponse((response) => {
      return response.request().method() === method
        && new URL(response.url()).pathname === pathname
    }, { timeout: ACP_RUNTIME_TIMEOUT })
  }

  private async expectSuccessfulMutation(responsePromise: Promise<Response>): Promise<Response> {
    const response = await responsePromise
    expect(response.ok(), await response.text()).toBe(true)
    return response
  }

  private async expectToast(title: string): Promise<void> {
    await expect(this.page.locator('[data-slot="toast-title"]').filter({ hasText: title }))
      .toHaveText(title, { timeout: ACP_RUNTIME_TIMEOUT })
  }
}
