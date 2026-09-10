import type { Locator, Response } from '@playwright/test'
import { expect } from '@playwright/test'

import type {
  PatchMcpServersByIdEnabledResponse,
  PostMcpServersResponse,
  PutMcpServersByIdResponse,
} from '../../../../apps/web/src/api-gen/types.gen'
import type { CradleWorld } from '../world'

const MCP_TIMEOUT = 15_000
const MCP_SERVER_ID_STATE = 'mcp-servers.server-id'
const INITIAL_NAME = 'journey-13-tools'
const UPDATED_NAME = 'journey-13-http'
const SECRET_KEYS = ['EMPTY_ALLOWED', 'JOURNEY_TOKEN'] as const

const INITIAL_BODY = {
  transport: 'stdio',
  name: INITIAL_NAME,
  enabled: true,
  command: 'node',
  args: ['--stdio', '--log-level=debug'],
  secretValues: {
    JOURNEY_TOKEN: 'secret-value',
    EMPTY_ALLOWED: '',
  },
} as const

const UPDATED_BODY = {
  transport: 'streamable-http',
  name: UPDATED_NAME,
  enabled: true,
  url: 'https://mcp.example.test/v2',
} as const

export class McpServersPage {
  constructor(private readonly world: CradleWorld) {}

  private get page() {
    return this.world.page
  }

  private settings(): Locator {
    return this.page.locator('[data-testid="mcp-servers-settings"]')
  }

  private dialog(): Locator {
    return this.page.getByRole('dialog')
  }

  private card(name: string): Locator {
    return this.settings()
      .locator('[data-testid="mcp-server-card"]')
      .filter({ has: this.page.getByText(name, { exact: true }) })
  }

  async expectEmpty(): Promise<void> {
    await expect(this.settings()).toBeVisible({ timeout: MCP_TIMEOUT })
    await expect(this.settings().getByRole('heading', { name: 'MCP servers', exact: true })).toBeVisible()
    await expect(this.settings().getByText('No MCP servers', { exact: true })).toBeVisible({ timeout: MCP_TIMEOUT })
    await expect(this.settings().locator('[data-testid="mcp-server-card"]')).toHaveCount(0)
  }

  async startAdding(): Promise<void> {
    await this.settings().locator('[data-testid="mcp-server-add"]').click()
    await expect(this.dialog()).toBeVisible({ timeout: MCP_TIMEOUT })
    await expect(this.dialog().getByRole('heading', { name: 'Add MCP server', exact: true })).toBeVisible()
  }

  async enterInvalidLocalConfig(): Promise<void> {
    await this.dialog().getByRole('textbox', { name: 'Name', exact: true }).fill(`  ${INITIAL_NAME}  `)
    await this.dialog().getByRole('textbox', { name: 'Command', exact: true }).fill('  node  ')
    await this.dialog()
      .getByRole('textbox', { name: 'Arguments', exact: true })
      .fill('  --stdio  \n\n --log-level=debug ')
    await this.dialog()
      .getByRole('textbox', { name: 'Environment variables', exact: true })
      .fill('JOURNEY_TOKEN=secret-value\ninvalid-secret-line\nEMPTY_ALLOWED=')
    await this.dialog().getByRole('button', { name: 'Save server', exact: true }).click()
  }

  async expectInvalidSecretLine(): Promise<void> {
    await expect(this.dialog().getByRole('alert')).toHaveText('Each secret must use NAME=value.')
    await expect(this.dialog()).toBeVisible()
  }

  async correctSecretsAndCreate(): Promise<void> {
    await this.dialog()
      .getByRole('textbox', { name: 'Environment variables', exact: true })
      .fill(' JOURNEY_TOKEN=secret-value \n\n EMPTY_ALLOWED=')

    const responsePromise = this.waitForMutation('POST', '/mcp-servers/')
    await this.dialog().getByRole('button', { name: 'Save server', exact: true }).click()
    const response = await this.expectSuccessfulMutation(responsePromise)
    expect(response.request().postDataJSON()).toEqual(INITIAL_BODY)

    const created: PostMcpServersResponse = await response.json()
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(created).toMatchObject({
      id: created.id,
      transport: INITIAL_BODY.transport,
      name: INITIAL_BODY.name,
      enabled: true,
      command: INITIAL_BODY.command,
      args: INITIAL_BODY.args,
      secretKeys: SECRET_KEYS,
      status: 'ready',
      supportedRuntimes: ['codex', 'claude-agent', 'opencode', 'kimi', 'jar-core', 'acp-chat'],
    })
    expect(Object.hasOwn(created, 'secretValues')).toBe(false)
    this.world.remember(MCP_SERVER_ID_STATE, created.id)
  }

  async expectLocalCreated(savedFeedback: boolean): Promise<void> {
    if (savedFeedback) {
      await this.expectToast('MCP server saved')
    }
    const card = this.card(INITIAL_NAME)
    await expect(card).toBeVisible({ timeout: MCP_TIMEOUT })
    await expect(card).toContainText('Ready')
    await expect(card).toContainText('$node --stdio --log-level=debug')
    await expect(card).toContainText(SECRET_KEYS.join(', '))
    await expect(card).toContainText('codex, claude-agent +4')
    await expect(card.getByRole('switch', { name: `Toggle ${INITIAL_NAME}`, exact: true })).toBeChecked()
  }

  async editLocalServer(): Promise<void> {
    await this.card(INITIAL_NAME).getByRole('button', { name: 'Edit', exact: true }).click()
    await expect(this.dialog().getByRole('heading', { name: 'Edit MCP server', exact: true })).toBeVisible({
      timeout: MCP_TIMEOUT,
    })
  }

  async expectStoredSecretsHidden(): Promise<void> {
    const dialog = this.dialog()
    await expect(dialog.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(INITIAL_NAME)
    await expect(dialog.getByRole('textbox', { name: 'Command', exact: true })).toHaveValue(INITIAL_BODY.command)
    await expect(dialog.getByRole('textbox', { name: 'Arguments', exact: true }))
      .toHaveValue(INITIAL_BODY.args.join('\n'))
    await expect(dialog.getByText(SECRET_KEYS[0], { exact: true })).toBeVisible()
    await expect(dialog.getByText(SECRET_KEYS[1], { exact: true })).toBeVisible()
    await expect(dialog.getByRole('switch', { name: 'Replace stored secrets', exact: true })).not.toBeChecked()
    await expect(dialog.getByRole('textbox', { name: 'Environment variables', exact: true })).toHaveCount(0)
    await expect(dialog).not.toContainText('secret-value')
  }

  async updateToHttp(): Promise<void> {
    const dialog = this.dialog()
    const httpTransport = dialog.getByRole('radio', { name: 'Streamable HTTP', exact: true })
    await expect(httpTransport).toBeVisible({ timeout: MCP_TIMEOUT })
    await httpTransport.click()
    await expect(httpTransport).toHaveAttribute('data-state', 'on')
    await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill(` ${UPDATED_NAME} `)
    await dialog.getByRole('textbox', { name: 'URL', exact: true }).fill(` ${UPDATED_BODY.url} `)

    const serverId = this.world.recall<string>(MCP_SERVER_ID_STATE)
    const responsePromise = this.waitForMutation('PUT', `/mcp-servers/${serverId}`)
    await dialog.getByRole('button', { name: 'Save server', exact: true }).click()
    const response = await this.expectSuccessfulMutation(responsePromise)
    expect(response.request().postDataJSON()).toEqual(UPDATED_BODY)

    const updated: PutMcpServersByIdResponse = await response.json()
    expect(updated).toMatchObject({
      id: serverId,
      ...UPDATED_BODY,
      secretKeys: SECRET_KEYS,
      status: 'ready',
      supportedRuntimes: ['codex', 'claude-agent', 'opencode', 'kimi', 'jar-core'],
    })
    expect(Object.hasOwn(updated, 'secretValues')).toBe(false)
  }

  async expectHttpUpdated(savedFeedback: boolean): Promise<void> {
    if (savedFeedback) {
      await this.expectToast('MCP server saved')
    }
    const card = this.card(UPDATED_NAME)
    await expect(card).toBeVisible({ timeout: MCP_TIMEOUT })
    await expect(this.card(INITIAL_NAME)).toHaveCount(0)
    await expect(card).toContainText('Ready')
    await expect(card).toContainText(UPDATED_BODY.url)
    await expect(card).toContainText(SECRET_KEYS.join(', '))
    await expect(card).toContainText('codex, claude-agent +3')
    await expect(card.getByRole('switch', { name: `Toggle ${UPDATED_NAME}`, exact: true })).toBeChecked()
  }

  async disableHttpServer(): Promise<void> {
    const serverId = this.world.recall<string>(MCP_SERVER_ID_STATE)
    const responsePromise = this.waitForMutation('PATCH', `/mcp-servers/${serverId}/enabled`)
    await this.card(UPDATED_NAME).getByRole('switch', { name: `Toggle ${UPDATED_NAME}`, exact: true }).click()
    const response = await this.expectSuccessfulMutation(responsePromise)
    expect(response.request().postDataJSON()).toEqual({ enabled: false })

    const disabled: PatchMcpServersByIdEnabledResponse = await response.json()
    expect(disabled).toMatchObject({
      id: serverId,
      ...UPDATED_BODY,
      enabled: false,
      secretKeys: SECRET_KEYS,
      status: 'disabled',
    })
  }

  async expectHttpDisabled(): Promise<void> {
    const card = this.card(UPDATED_NAME)
    await expect(card).toBeVisible({ timeout: MCP_TIMEOUT })
    await expect(card).toContainText('Disabled')
    await expect(card).toContainText(UPDATED_BODY.url)
    await expect(card).toContainText(SECRET_KEYS.join(', '))
    await expect(card.getByRole('switch', { name: `Toggle ${UPDATED_NAME}`, exact: true })).not.toBeChecked()
  }

  async deleteHttpServer(): Promise<void> {
    await this.card(UPDATED_NAME).getByRole('button', { name: 'Delete', exact: true }).click()
    const confirmation = this.page.getByRole('alertdialog')
    await expect(confirmation).toBeVisible({ timeout: MCP_TIMEOUT })
    await expect(confirmation).toContainText(`Delete ${UPDATED_NAME}? This cannot be undone.`)

    const serverId = this.world.recall<string>(MCP_SERVER_ID_STATE)
    const responsePromise = this.waitForMutation('DELETE', `/mcp-servers/${serverId}`)
    await confirmation.getByRole('button', { name: 'Delete', exact: true }).click()
    const response = await this.expectSuccessfulMutation(responsePromise)
    expect(await response.json()).toEqual({ ok: true })
  }

  async expectDeleted(savedFeedback: boolean): Promise<void> {
    if (savedFeedback) {
      await this.expectToast('MCP server deleted')
    }
    await this.expectEmpty()
    await expect(this.settings().getByText(UPDATED_NAME, { exact: true })).toHaveCount(0)
  }

  private waitForMutation(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', pathname: string): Promise<Response> {
    return this.page.waitForResponse((response) => {
      return response.request().method() === method
        && new URL(response.url()).pathname === pathname
    }, { timeout: MCP_TIMEOUT })
  }

  private async expectSuccessfulMutation(responsePromise: Promise<Response>): Promise<Response> {
    const response = await responsePromise
    expect(response.ok(), await response.text()).toBe(true)
    return response
  }

  private async expectToast(title: string): Promise<void> {
    await expect(this.page.locator('[data-slot="toast-title"]').filter({ hasText: title }))
      .toHaveText(title, { timeout: MCP_TIMEOUT })
  }
}
