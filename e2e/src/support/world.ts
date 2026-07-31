import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { SimulatorExchange, SimulatorScenario } from '@cradle/model-api-simulator'
import type { IWorldOptions } from '@cucumber/cucumber'
import { setWorldConstructor, World } from '@cucumber/cucumber'
import type { Browser, BrowserContext, Page } from '@playwright/test'
import { chromium, expect } from '@playwright/test'

import type { E2ESimulator } from './model-api-simulator'
import { startE2ESimulator } from './model-api-simulator'
import { ApprovalPage, ChatPage, NewChatPage } from './pages/chat'
import {
  configureClaudeAgentSimulatorProvider,
  configureStandardSimulatorProvider,
  E2E_CLAUDE_AGENT_NAME,
  E2E_OPENAI_AGENT_NAME,
} from './providers'
import { anthropicApprovalExchanges, anthropicScenario, anthropicTextExchange } from './scenarios/anthropic'
import {
  openAiHttpErrorExchange,
  openAiScenario,
  openAiTextExchange,
} from './scenarios/openai'
import { getManagedServerUrl, getManagedWebUrl } from './server-lifecycle'
import type { ScenarioArtifactPaths } from './world-utils'
import { buildScenarioArtifactPaths } from './world-utils'

interface WorldParameters {
  webUrl: string
  serverUrl: string
}

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
  simulator: E2ESimulator | null = null
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

  get newChat(): NewChatPage {
    return new NewChatPage(this.page)
  }

  get chat(): ChatPage {
    return new ChatPage(this.page)
  }

  get approval(): ApprovalPage {
    return new ApprovalPage(this.page)
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

  async selectDirectoryInBrowser(dirPath: string): Promise<void> {
    const dialog = this.page.locator('[data-testid="directory-browser-dialog"]')
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    const breadcrumbBar = dialog.locator('[data-testid="directory-browser-breadcrumb"]')
    await breadcrumbBar.dblclick()
    const pathInput = dialog.locator('[data-testid="directory-browser-path-input"]')
    await expect(pathInput).toBeVisible({ timeout: 5_000 })
    await pathInput.fill(dirPath)
    await pathInput.press('Enter')
    await expect(dialog.locator('[data-testid="directory-browser-confirm"]')).toBeEnabled({ timeout: 10_000 })
    await dialog.locator('[data-testid="directory-browser-confirm"]').click()
    await expect(dialog).toBeHidden({ timeout: 5_000 })
  }

  pushConsoleMessage(message: string): void {
    this.consoleMessages.push(message)
  }

  async ensureSimulator(): Promise<E2ESimulator> {
    if (!this.simulator) {
      this.simulator = await startE2ESimulator()
    }
    return this.simulator
  }

  enqueue(scenario: SimulatorScenario): void {
    if (!this.simulator) {
      throw new Error('Simulator is not started')
    }
    this.simulator.enqueue(scenario)
  }

  enqueueOpenAi(...exchanges: SimulatorExchange[]): void {
    this.enqueue(openAiScenario(exchanges))
  }

  enqueueAnthropic(...exchanges: SimulatorExchange[]): void {
    this.enqueue(anthropicScenario(exchanges))
  }

  async configureStandardChat(options: {
    texts?: string[]
    reasoningText?: string
    gateAfterCreated?: string
    chunkDelayYields?: number
    failureMessage?: string
  } = {}): Promise<void> {
    const simulator = await this.ensureSimulator()
    simulator.reset()

    if (options.failureMessage) {
      this.enqueueOpenAi(openAiHttpErrorExchange({
        label: 'forced-failure',
        message: options.failureMessage,
      }))
    }
    else {
      const texts = options.texts?.length ? options.texts : ['Hello from E2E simulator!']
      this.enqueueOpenAi(...texts.map((text, index) => openAiTextExchange({
        label: `turn-${index + 1}`,
        text,
        reasoningText: index === 0 ? options.reasoningText : undefined,
        gateAfterCreated: index === 0 ? options.gateAfterCreated : undefined,
        chunkDelayYields: options.chunkDelayYields,
      })))
    }

    await configureStandardSimulatorProvider({
      serverUrl: this.params.serverUrl,
      openaiBaseUrl: simulator.openaiBaseUrl,
      createTempDir: () => this.createTempWorkspaceDir(),
    })
    this.remember('chat.preferred-runtime', 'standard' as const)
    this.remember('chat.preferred-provider', E2E_OPENAI_AGENT_NAME)
    await this.page?.reload({ waitUntil: 'domcontentloaded' })
  }

  async configureClaudeAgentChat(options: {
    mode?: 'approval' | 'text'
    text?: string
    planText?: string
    completionText?: string
  } = {}): Promise<void> {
    const simulator = await this.ensureSimulator()
    simulator.reset()

    if (options.mode === 'approval') {
      this.enqueueAnthropic(...anthropicApprovalExchanges({
        planText: options.planText,
        completionText: options.completionText,
      }))
    }
    else {
      this.enqueueAnthropic(anthropicTextExchange({
        label: 'claude-text',
        text: options.text ?? 'Hello from Claude Agent E2E simulator!',
      }))
    }

    await configureClaudeAgentSimulatorProvider({
      serverUrl: this.params.serverUrl,
      anthropicBaseUrl: simulator.anthropicBaseUrl,
      createTempDir: () => this.createTempWorkspaceDir(),
      permissionMode: options.mode === 'approval' ? 'default' : 'bypassPermissions',
    })
    this.remember('chat.preferred-runtime', 'claude-agent' as const)
    this.remember('chat.preferred-provider', E2E_CLAUDE_AGENT_NAME)
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
    const resetResponse = await fetch(`${this.params.serverUrl}/test/reset`, { method: 'POST' })
    if (!resetResponse.ok) {
      throw new Error(`Failed to reset server state: ${resetResponse.status} ${await resetResponse.text()}`)
    }

    this.simulator = await startE2ESimulator()

    this.browser = await chromium.launch({ headless: !process.env.CRADLE_E2E_HEADED })
    this.context = await this.browser.newContext({
      permissions: ['clipboard-read', 'clipboard-write'],
    })
    await this.context.addInitScript(() => {
      window.localStorage.setItem('cradle:onboarding:v1', JSON.stringify({
        state: { completed: true, step: 4 },
        version: 1,
      }))
      // Skip first-run provider/GitHub setup dialog so E2E can reach core surfaces.
      window.localStorage.setItem('cradle:first-run-setup:v2', JSON.stringify({
        state: { completedSteps: { provider: true, github: true } },
        version: 2,
      }))
      // Suppress What's New corner popup noise.
      window.localStorage.setItem('cradle:whats-new:v1', JSON.stringify({
        state: {
          dismissedAnnouncements: ['*'],
          dismissedTips: ['*'],
        },
        version: 1,
      }))
    })
    this.page = await this.context.newPage()
    await this.page.goto(this.params.webUrl)
    await this.page.waitForLoadState('domcontentloaded')
  }

  async close(): Promise<void> {
    if (this.simulator) {
      await this.simulator.close()
      this.simulator = null
    }
    await this.context?.close()
    await this.browser?.close()
  }

  async mainProcess<T = unknown>(_fn: unknown, _arg?: unknown): Promise<T> {
    throw new Error('mainProcess() is not available in web mode. Use page.evaluate() or server API instead.')
  }
}

setWorldConstructor(CradleWorld)
