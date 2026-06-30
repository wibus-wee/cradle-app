import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { IWorldOptions } from '@cucumber/cucumber'
import { setWorldConstructor, World } from '@cucumber/cucumber'
import type { Browser, BrowserContext, Page } from '@playwright/test'
import { chromium, expect } from '@playwright/test'

import type { MockLlmFailureMode, MockToolCall } from './mock-llm-server'
import { MockLlmServer } from './mock-llm-server'
import { getManagedServerUrl, getManagedWebUrl } from './server-lifecycle'
import type { ScenarioArtifactPaths } from './world-utils'
import {
  buildScenarioArtifactPaths,
} from './world-utils'

// ── World parameters (from cucumber.mjs worldParameters) ─────────────────────

interface WorldParameters {
  webUrl: string
  serverUrl: string
}

// ── Custom world ──────────────────────────────────────────────────────────────

export class CradleWorld extends World {
  private static scenarioCounter = 0

  browser!: Browser
  context!: BrowserContext
  page!: Page
  skillWorkspaceDir?: string
  skillAgentIds: Record<string, string> = {}
  scenarioArtifacts: ScenarioArtifactPaths | null = null
  scenarioName = ''
  consoleMessages: string[] = []
  mockLlmServer: MockLlmServer | null = null
  mockLlmBaseUrl = ''
  private readonly scenarioState = new Map<string, unknown>()

  constructor(options: IWorldOptions) {
    super(options)
  }

  get params(): WorldParameters {
    const base = this.parameters as WorldParameters
    const managedServerUrl = getManagedServerUrl()
    const managedWebUrl = getManagedWebUrl()
    return {
      ...base,
      ...(managedServerUrl ? { serverUrl: managedServerUrl } : {}),
      ...(managedWebUrl ? { webUrl: managedWebUrl } : {}),
    }
  }

  static nextScenarioIndex(): number {
    CradleWorld.scenarioCounter += 1
    return CradleWorld.scenarioCounter
  }

  prepareScenario(name: string, artifactsRoot = join(process.cwd(), 'e2e', 'artifacts')): void {
    this.scenarioName = name
    this.consoleMessages = []
    this.scenarioState.clear()
    this.scenarioArtifacts = buildScenarioArtifactPaths(
      artifactsRoot,
      name,
      CradleWorld.nextScenarioIndex(),
    )
  }

  remember<T>(key: string, value: T): void {
    this.scenarioState.set(key, value)
  }

  recall<T>(key: string): T {
    if (!this.scenarioState.has(key)) {
      throw new Error(`Missing scenario state: ${key}`)
    }
    return this.scenarioState.get(key) as T
  }

  maybeRecall<T>(key: string): T | undefined {
    return this.scenarioState.get(key) as T | undefined
  }

  createTempWorkspaceDir(prefix = 'cradle-e2e-ws-'): string {
    return mkdtempSync(join(tmpdir(), prefix))
  }

  /**
   * Selects a directory via the DirectoryBrowserDialog UI.
   * Call this AFTER clicking the button that opens the dialog.
   * Double-clicks the breadcrumb to enter edit mode, types the path, presses Enter, then clicks confirm.
   */
  async selectDirectoryInBrowser(dirPath: string): Promise<void> {
    const dialog = this.page.locator('[data-testid="directory-browser-dialog"]')
    await expect(dialog).toBeVisible({ timeout: 10_000 })

    // Double-click the breadcrumb bar to enter edit mode
    const breadcrumbBar = dialog.locator('[data-testid="directory-browser-breadcrumb"]')
    await breadcrumbBar.dblclick()

    // Fill the path input that appears
    const pathInput = dialog.locator('[data-testid="directory-browser-path-input"]')
    await expect(pathInput).toBeVisible({ timeout: 5_000 })
    await pathInput.fill(dirPath)
    await pathInput.press('Enter')

    // Wait for the confirm button to become enabled (loading done)
    await expect(dialog.locator('[data-testid="directory-browser-confirm"]')).toBeEnabled({ timeout: 10_000 })

    await dialog.locator('[data-testid="directory-browser-confirm"]').click()
    await expect(dialog).toBeHidden({ timeout: 5_000 })
  }

  pushConsoleMessage(message: string): void {
    this.consoleMessages.push(message)
  }

  async configureMockLlmProvider(options: {
    responseText?: string
    responseTexts?: string[]
    reasoningText?: string
    toolCalls?: MockToolCall[]
    chunkDelay?: number
    failureMode?: MockLlmFailureMode
    errorStatusCode?: number
    errorMessage?: string
  } = {}): Promise<void> {
    if (this.mockLlmServer) {
      await this.mockLlmServer.stop()
    }

    this.mockLlmServer = new MockLlmServer(options)
    this.mockLlmBaseUrl = await this.mockLlmServer.start()

    const response = await fetch(`${this.params.serverUrl}/profiles/mock-llm-profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Mock LLM',
        providerKind: 'openai-compatible',
        enabled: true,
        config: {
          baseUrl: this.mockLlmBaseUrl,
          model: 'mock-model',
          apiMode: 'responses',
          apiKey: 'sk-mock-test-key',
        },
        credentialRef: null,
      }),
    })
    if (!response.ok) {
      throw new Error(`Failed to configure mock LLM provider: ${response.status} ${await response.text()}`)
    }

    const agentsResponse = await fetch(`${this.params.serverUrl}/agents`)
    if (!agentsResponse.ok) {
      throw new Error(`Failed to list agents for mock LLM provider: ${agentsResponse.status} ${await agentsResponse.text()}`)
    }
    const agents = await agentsResponse.json() as Array<{ name?: unknown, providerTargetId?: unknown }>
    const hasMockAgent = agents.some(agent => agent.name === 'Mock LLM' && agent.providerTargetId === 'mock-llm-profile')
    if (!hasMockAgent) {
      const agentResponse = await fetch(`${this.params.serverUrl}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Mock LLM',
          avatarStyle: 'dicebear',
          avatarSeed: 'Mock LLM',
          providerTargetId: 'mock-llm-profile',
          modelId: 'mock-model',
          runtimeKind: 'standard',
        }),
      })
      if (!agentResponse.ok) {
        throw new Error(`Failed to create mock LLM agent: ${agentResponse.status} ${await agentResponse.text()}`)
      }
    }

    // Ensure at least one workspace exists so the send button becomes enabled
    await this.ensureWorkspaceExists()

    await this.page?.reload({ waitUntil: 'domcontentloaded' })
  }

  async ensureWorkspaceExists(): Promise<void> {
    const listRes = await fetch(`${this.params.serverUrl}/workspaces`)
    if (listRes.ok) {
      const workspaces = await listRes.json() as unknown[]
      if (workspaces.length > 0) {
        return
      }
    }
    const dir = this.createTempWorkspaceDir('cradle-e2e-ws-')
    const res = await fetch(`${this.params.serverUrl}/workspaces/from-directory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: dir }),
    })
    if (!res.ok) {
      throw new Error(`Failed to create workspace: ${res.status} ${await res.text()}`)
    }
  }

  async launch(): Promise<void> {
    // Reset server state for clean test isolation
    const resetResponse = await fetch(`${this.params.serverUrl}/test/reset`, { method: 'POST' })
    if (!resetResponse.ok) {
      throw new Error(`Failed to reset server state: ${resetResponse.status} ${await resetResponse.text()}`)
    }

    // Launch browser
    this.browser = await chromium.launch({ headless: !process.env.CRADLE_E2E_HEADED })
    this.context = await this.browser.newContext({
      permissions: ['clipboard-read', 'clipboard-write'],
    })
    await this.context.addInitScript(() => {
      window.localStorage.setItem('cradle:onboarding:v1', JSON.stringify({
        state: { completed: true, step: 4 },
        version: 1,
      }))
    })
    this.page = await this.context.newPage()
    await this.page.goto(this.params.webUrl)
    await this.page.waitForLoadState('domcontentloaded')
  }

  async close(): Promise<void> {
    if (this.mockLlmServer) {
      await this.mockLlmServer.stop()
      this.mockLlmServer = null
      this.mockLlmBaseUrl = ''
    }
    await this.context?.close()
    await this.browser?.close()
  }

  /**
   * @deprecated mainProcess() is not available in web mode. Use page.evaluate() or server API instead.
   */

  async mainProcess<T = unknown>(_fn: unknown, _arg?: unknown): Promise<T> {
    throw new Error('mainProcess() is not available in web mode. Use page.evaluate() or server API instead.')
  }
}

setWorldConstructor(CradleWorld)
