import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import type { Browser, BrowserContext, Page } from '@playwright/test'
import { chromium, expect, test } from '@playwright/test'

import type { E2ESimulator } from '../support/model-api-simulator'
import { startE2ESimulator } from '../support/model-api-simulator'
import { ApprovalPage, ChatPage, NewChatPage } from '../support/pages/chat'
import {
  E2E_ANTHROPIC_PROFILE_ID,
  E2E_CLAUDE_AGENT_NAME,
  E2E_CODEX_AGENT_NAME,
  E2E_CODEX_PROFILE_ID,
  ensureAgentForProfile,
  upsertAnthropicSimulatorProfile,
  upsertCodexSimulatorProfile,
} from '../support/providers'
import {
  anthropicScenario,
  anthropicTextExchange,
  anthropicToolUseExchange,
  E2E_ANTHROPIC_MODEL,
} from '../support/scenarios/anthropic'
import { E2E_OPENAI_MODEL, openAiScenario, openAiTextExchange } from '../support/scenarios/openai'
import type { FabricNodeProcess, FabricTopology } from './topology'
import { startFabricTopology } from './topology'

interface WorkspaceSummary {
  id: string
  name: string
  locator: { nodeId: string, path: string, sourceWorkspaceId?: string | null }
}

interface FabricMembership {
  localNodeId: string
  fabricId: string
}

interface PendingControllerRequest {
  requestId: string
  subjectId: string
  displayName: string
}

interface NodeGrant {
  grantId: string
  controllerId: string
  scope: 'view' | 'control' | 'approve' | 'admin'
  revokedAt?: string | null
}

interface SessionSummary {
  id: string
  title: string | null
  workspaceId: string | null
  execution: { kind: 'local' } | { kind: 'node', nodeId: string, remoteSessionId: string }
}

interface SessionPage {
  items: SessionSummary[]
  nextCursor: string | null
}

interface WorkDetail {
  work: { id: string, title: string }
  primaryThread: SessionSummary
  execution: {
    isIsolated: boolean
    worktreeId: string | null
    worktreePath: string | null
    worktreeHealth: string | null
  }
}

let topology: FabricTopology
let browser: Browser
let desktopContext: BrowserContext
let macbookContext: BrowserContext
let desktopPage: Page
let macbookPage: Page
let desktopSimulator: E2ESimulator
let macbookSimulator: E2ESimulator

const mobileIosEnabled = process.env.CRADLE_E2E_MOBILE_IOS === '1'

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) {
    throw new Error(`${init?.method ?? 'GET'} ${url} failed: ${response.status} ${await response.text()}`)
  }
  return await response.json() as T
}

async function createNodeContext(node: FabricNodeProcess): Promise<{ context: BrowserContext, page: Page }> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    permissions: ['clipboard-read', 'clipboard-write'],
  })
  await context.addInitScript(({ serverUrl }) => {
    window.localStorage.setItem('cradle.web.serverEndpointUrl', serverUrl)
    window.localStorage.setItem('cradle:onboarding:v1', JSON.stringify({
      state: { completed: true, step: 4 },
      version: 1,
    }))
    window.localStorage.setItem('cradle:first-run-setup:v2', JSON.stringify({
      state: { completedSteps: { provider: true, github: true } },
      version: 2,
    }))
    window.localStorage.setItem('cradle:whats-new:v1', JSON.stringify({
      state: {
        dismissedAnnouncements: ['dev-mock-20260723.1', 'dev-mock-20260710.1'],
        dismissedTips: ['dev-mock-tip-split-workspace', 'dev-mock-tip-external-link'],
      },
      version: 1,
    }))
  }, { serverUrl: node.serverUrl })
  const page = await context.newPage()
  page.setDefaultTimeout(30_000)
  return { context, page }
}

async function configureNode(node: FabricNodeProcess, simulator: E2ESimulator): Promise<void> {
  await upsertCodexSimulatorProfile({
    serverUrl: node.serverUrl,
    openaiBaseUrl: simulator.openaiBaseUrl,
  })
  await ensureAgentForProfile({
    serverUrl: node.serverUrl,
    name: E2E_CODEX_AGENT_NAME,
    providerTargetId: E2E_CODEX_PROFILE_ID,
    modelId: E2E_OPENAI_MODEL,
    runtimeKind: 'codex',
  })
}

async function configureClaudeNode(node: FabricNodeProcess, simulator: E2ESimulator): Promise<void> {
  await upsertAnthropicSimulatorProfile({
    serverUrl: node.serverUrl,
    anthropicBaseUrl: simulator.anthropicBaseUrl,
  })
  await ensureAgentForProfile({
    serverUrl: node.serverUrl,
    name: E2E_CLAUDE_AGENT_NAME,
    providerTargetId: E2E_ANTHROPIC_PROFILE_ID,
    modelId: E2E_ANTHROPIC_MODEL,
    runtimeKind: 'claude-agent',
  })
}

async function addLocalWorkspace(page: Page, node: FabricNodeProcess, path: string): Promise<WorkspaceSummary> {
  await page.goto(topology.webUrl)
  await expect(page.locator('[data-testid="app-sidebar"]')).toBeVisible()
  const emptyButton = page.locator('[data-testid="add-workspace-empty-btn"]')
  const headerButton = page.locator('[data-testid="add-workspace-btn"]')
  if (await emptyButton.isVisible().catch(() => false)) {
    await emptyButton.click()
  }
  else {
    await headerButton.click()
  }
  const chooseFolder = page.getByRole('button', { name: /Choose folder|选择文件夹|選擇資料夾/i })
  await expect(chooseFolder).toBeVisible()
  await chooseFolder.click()
  const dialog = page.locator('[data-testid="directory-browser-dialog"]')
  await expect(dialog).toBeVisible()
  await dialog.locator('[data-testid="directory-browser-breadcrumb"]').dblclick()
  const pathInput = dialog.locator('[data-testid="directory-browser-path-input"]')
  await expect(pathInput).toBeVisible()
  await pathInput.fill(path)
  await pathInput.press('Enter')
  await expect(dialog.locator('[data-testid="directory-browser-breadcrumb"]')).toContainText(basename(path))
  const confirm = dialog.locator('[data-testid="directory-browser-confirm"]')
  await expect(confirm).toBeEnabled()
  await confirm.click()
  await expect(dialog).toBeHidden()

  let workspace: WorkspaceSummary | undefined
  await expect.poll(async () => {
    const workspaces = await json<WorkspaceSummary[]>(`${node.serverUrl}/workspaces`)
    workspace = workspaces.find(candidate => candidate.locator.path === path)
    return workspace?.id ?? null
  }).not.toBeNull()
  return workspace!
}

async function openNodeSettings(page: Page): Promise<void> {
  await page.goto(topology.webUrl)
  await page.locator('[data-testid="settings-btn"]').click()
  await expect(page.locator('[data-testid="settings-sidebar"]')).toBeVisible()
  await page.locator('[data-testid="settings-nav-nodes"]').click()
  await expect(page.locator('[data-testid="nodes-settings"]')).toBeVisible()
}

function initializeGitWorkspace(path: string, markerName: string, markerContent: string): void {
  writeFileSync(join(path, markerName), markerContent)
  execFileSync('git', ['init'], { cwd: path })
  execFileSync('git', ['config', 'user.email', 'fabric-e2e@example.com'], { cwd: path })
  execFileSync('git', ['config', 'user.name', 'Fabric E2E'], { cwd: path })
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: path })
  execFileSync('git', ['add', markerName], { cwd: path })
  execFileSync('git', ['commit', '-m', 'Initialize Fabric E2E workspace'], { cwd: path })
}

async function pairNodesThroughUi(): Promise<{
  desktopMembership: FabricMembership
  macbookMembership: FabricMembership
}> {
  await openNodeSettings(desktopPage)
  await desktopPage.locator('[data-testid="nodes-link-device"]').click()
  await desktopPage.locator('[data-testid="connect-start"]').click()
  const networkCode = desktopPage.locator('[data-testid="connect-network-code"]')
  await expect(networkCode).toBeVisible()
  const code = (await networkCode.textContent())?.trim()
  expect(code).toBeTruthy()
  await desktopPage.keyboard.press('Escape')
  await expect(desktopPage.getByRole('dialog')).toBeHidden()

  await openNodeSettings(macbookPage)
  await macbookPage.locator('[data-testid="nodes-link-device"]').click()
  await macbookPage.locator('[data-testid="connect-join"]').click()
  await macbookPage.locator('[data-testid="connect-network-code-input"]').fill(code!)
  await macbookPage.locator('[data-testid="connect-join-submit"]').click()
  await expect(macbookPage.locator('[data-testid="connect-invite-code"]')).toBeVisible()

  const pending = desktopPage.locator('[data-testid^="node-pending-request-"]')
  await expect(pending).toBeVisible({ timeout: 45_000 })
  await pending.locator('[data-testid^="node-pending-approve-"]').click()

  let desktopMembership: FabricMembership | null = null
  let macbookMembership: FabricMembership | null = null
  await expect.poll(async () => {
    desktopMembership = await json<FabricMembership | null>(`${topology.desktop.serverUrl}/fabric`)
    macbookMembership = await json<FabricMembership | null>(`${topology.macbook.serverUrl}/fabric`)
    return Boolean(desktopMembership && macbookMembership)
  }, { timeout: 45_000 }).toBe(true)

  await expect.poll(async () => {
    const [desktopNodes, macbookNodes] = await Promise.all([
      json<Array<{ status: string }>>(`${topology.desktop.serverUrl}/nodes`),
      json<Array<{ status: string }>>(`${topology.macbook.serverUrl}/nodes`),
    ])
    return desktopNodes.length === 2
      && macbookNodes.length === 2
      && desktopNodes.every(node => node.status === 'online')
      && macbookNodes.every(node => node.status === 'online')
  }, { timeout: 45_000 }).toBe(true)

  return { desktopMembership: desktopMembership!, macbookMembership: macbookMembership! }
}

async function ensurePairedNodes(): Promise<{
  desktopMembership: FabricMembership
  macbookMembership: FabricMembership
}> {
  const [desktopMembership, macbookMembership] = await Promise.all([
    json<FabricMembership | null>(`${topology.desktop.serverUrl}/fabric`),
    json<FabricMembership | null>(`${topology.macbook.serverUrl}/fabric`),
  ])
  if (desktopMembership && macbookMembership) {
    return { desktopMembership, macbookMembership }
  }
  expect(desktopMembership).toBeNull()
  expect(macbookMembership).toBeNull()
  return await pairNodesThroughUi()
}

async function runMaestroFlow(flowName: string, variables: Record<string, string>): Promise<void> {
  const maestroPath = process.env.MAESTRO_CLI_PATH?.trim()
  const simulatorUdid = process.env.CRADLE_E2E_IOS_UDID?.trim()
  const artifactsRoot = process.env.CRADLE_E2E_MOBILE_ARTIFACTS_DIR?.trim()
  if (!maestroPath || !simulatorUdid || !artifactsRoot) {
    throw new Error('Mobile Fabric E2E requires MAESTRO_CLI_PATH, CRADLE_E2E_IOS_UDID, and CRADLE_E2E_MOBILE_ARTIFACTS_DIR.')
  }

  const flowPath = join(import.meta.dirname, '..', '..', 'mobile', 'maestro', `${flowName}.yaml`)
  const outputDir = join(artifactsRoot, flowName)
  mkdirSync(outputDir, { recursive: true })
  const variableArgs = Object.entries(variables).flatMap(([key, value]) => ['-e', `${key}=${value}`])
  const child = spawn(maestroPath, [
    'test',
    '--udid',
    simulatorUdid,
    '--no-ansi',
    '--debug-output',
    join(outputDir, 'debug'),
    '--test-output-dir',
    join(outputDir, 'tests'),
    '--format',
    'JUNIT',
    '--output',
    join(outputDir, 'junit.xml'),
    ...variableArgs,
    flowPath,
  ], {
    cwd: join(import.meta.dirname, '..', '..', '..'),
    env: {
      ...process.env,
      MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: 'true',
      MAESTRO_CLI_NO_ANALYTICS: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', chunk => output += chunk)
  child.stderr.on('data', chunk => output += chunk)
  let status: number | null
  try {
    status = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', resolve)
    })
  }
  catch (cause) {
    writeFileSync(join(outputDir, 'maestro.log'), output)
    throw cause
  }
  writeFileSync(join(outputDir, 'maestro.log'), output)
  if (status !== 0) {
    throw new Error(`Maestro flow ${flowName} failed (${status ?? 'signal'}).\n${output}`)
  }
}

async function rejoinMacbookThroughUi(previousNodeId: string): Promise<FabricMembership> {
  const leave = await fetch(`${topology.macbook.serverUrl}/fabric`, { method: 'DELETE' })
  expect(leave.status).toBe(204)

  await openNodeSettings(desktopPage)
  await desktopPage.locator('[data-testid="nodes-link-device"]').click()
  const networkCode = desktopPage.locator('[data-testid="connect-network-code"]')
  await expect(networkCode).toBeVisible()
  const code = (await networkCode.textContent())?.trim()
  expect(code).toBeTruthy()
  await desktopPage.keyboard.press('Escape')

  await macbookPage.reload()
  await openNodeSettings(macbookPage)
  await macbookPage.locator('[data-testid="nodes-link-device"]').click()
  await macbookPage.locator('[data-testid="connect-join"]').click()
  await macbookPage.locator('[data-testid="connect-network-code-input"]').fill(code!)
  await macbookPage.locator('[data-testid="connect-join-submit"]').click()
  await expect(macbookPage.locator('[data-testid="connect-invite-code"]')).toBeVisible()

  const pending = desktopPage.locator('[data-testid^="node-pending-request-"]')
  await expect(pending).toBeVisible({ timeout: 45_000 })
  await pending.locator('[data-testid^="node-pending-approve-"]').click()

  let membership: FabricMembership | null = null
  await expect.poll(async () => {
    membership = await json<FabricMembership | null>(`${topology.macbook.serverUrl}/fabric`)
    return membership && membership.localNodeId !== previousNodeId
      ? membership.localNodeId
      : null
  }, { timeout: 45_000 }).not.toBeNull()
  return membership!
}

async function mountRemoteWorkspace(input: {
  page: Page
  controller: FabricNodeProcess
  targetNodeId: string
  remoteWorkspace: WorkspaceSummary
}): Promise<WorkspaceSummary> {
  await input.page.goto(topology.webUrl)
  const addButton = input.page.locator('[data-testid="add-workspace-btn"]')
  await expect(addButton).toBeVisible()
  await addButton.click()
  await input.page.locator(`[data-testid="node-pick-${input.targetNodeId}"]`).click()
  const picker = input.page.locator('[data-testid="node-workspace-picker"]')
  await expect(picker).toBeVisible()
  await expect(picker.locator('[data-testid="node-workspace-empty"]')).toHaveCount(0)
  const row = picker.locator('[data-testid^="node-workspace-"]').filter({
    hasText: input.remoteWorkspace.name,
  }).first()
  await expect(row).toBeVisible()
  await row.locator('[data-testid^="node-workspace-add-"]').click()

  let mounted: WorkspaceSummary | undefined
  await expect.poll(async () => {
    const workspaces = await json<WorkspaceSummary[]>(`${input.controller.serverUrl}/workspaces`)
    mounted = workspaces.find(workspace =>
      workspace.locator.nodeId === input.targetNodeId
      && workspace.locator.sourceWorkspaceId === input.remoteWorkspace.id)
    return mounted?.id ?? null
  }).not.toBeNull()
  return mounted!
}

async function sendChat(input: {
  page: Page
  workspaceId: string
  prompt: string
  response: string
  targetSimulator: E2ESimulator
}): Promise<string> {
  input.targetSimulator.enqueue(openAiScenario([
    openAiTextExchange({
      label: input.prompt,
      text: input.response,
      bodyTextIncludes: input.prompt,
      bodyTextExcludes: 'You are naming a Codex task thread.',
    }),
  ]))
  const newChat = new NewChatPage(input.page)
  const chat = new ChatPage(input.page)
  await input.page.goto(topology.webUrl)
  await newChat.openFromNav()
  await newChat.workspaceSelector().click()
  await input.page.locator(`[data-testid="new-chat-workspace-option-${input.workspaceId}"]`).click()
  await newChat.selectRuntime(/Codex/i)
  await newChat.selectProvider(E2E_CODEX_AGENT_NAME)
  await newChat.fill(input.prompt)
  await newChat.send()
  await chat.expectAssistantContains(input.response, 60_000)
  input.targetSimulator.assertExhausted()
  return await chat.sessionId()
}

async function createWork(input: {
  page: Page
  controller: FabricNodeProcess
  authority: FabricNodeProcess
  workspaceId: string
  authorityNodeId: string
  goal: string
  response: string
  followUp: string
  followUpResponse: string
  targetSimulator: E2ESimulator
}): Promise<WorkDetail> {
  input.targetSimulator.enqueue(openAiScenario([
    openAiTextExchange({
      label: input.goal,
      text: input.response,
      bodyTextIncludes: input.goal,
      bodyTextExcludes: 'You are naming a Codex task thread.',
    }),
  ]))
  const composer = new NewChatPage(input.page)
  const chat = new ChatPage(input.page)
  await input.page.goto(`${topology.webUrl}/#/work/new`)
  await expect(input.page.locator('[data-testid="new-work-page"]')).toBeVisible()
  await input.page.locator('[data-testid="new-work-workspace-selector"]').click()
  await input.page.locator(`[data-testid="new-work-workspace-option-${input.workspaceId}"]`).click()
  await composer.selectRuntime(/Codex/i)
  await composer.selectProvider(E2E_CODEX_AGENT_NAME)
  await input.page.locator('[data-testid="new-work-textarea"]').fill(input.goal)
  const send = input.page.locator('[data-testid="new-work-send-btn"]')
  await expect(send).toBeEnabled()
  await send.click()
  await chat.expectAssistantContains(input.response, 60_000)
  input.targetSimulator.assertExhausted()

  const localSessionId = await chat.sessionId()
  const localWork = await json<{ work: { id: string } | null }>(
    `${input.controller.serverUrl}/sessions/${localSessionId}/work`,
  )
  expect(localWork.work).not.toBeNull()
  const detail = await json<WorkDetail>(`${input.controller.serverUrl}/works/${localWork.work!.id}`)
  expect(detail.primaryThread.execution).toEqual(expect.objectContaining({
    kind: 'node',
    nodeId: input.authorityNodeId,
  }))
  expect(detail.execution.isIsolated).toBe(true)
  expect(detail.execution.worktreeHealth).toBe('ok')
  expect(detail.execution.worktreePath).not.toBeNull()
  expect(existsSync(detail.execution.worktreePath!)).toBe(true)

  const remoteSessionId = detail.primaryThread.execution.kind === 'node'
    ? detail.primaryThread.execution.remoteSessionId
    : ''
  const authoritativeWork = await json<{ work: { id: string } | null }>(
    `${input.authority.serverUrl}/sessions/${remoteSessionId}/work`,
  )
  expect(authoritativeWork.work).not.toBeNull()
  expect(authoritativeWork.work!.id).not.toBe(detail.work.id)

  input.targetSimulator.enqueue(openAiScenario([
    openAiTextExchange({
      label: input.followUp,
      text: input.followUpResponse,
      bodyTextIncludes: input.followUp,
      bodyTextExcludes: 'You are naming a Codex task thread.',
    }),
  ]))
  await chat.fillAndSend(input.followUp)
  await chat.expectAssistantContains(input.followUpResponse, 60_000)
  input.targetSimulator.assertExhausted()
  return detail
}

async function approveRemoteToolRequest(input: {
  page: Page
  controller: FabricNodeProcess
  authority: FabricNodeProcess
  workspaceId: string
  authorityNodeId: string
  prompt: string
  planText: string
  response: string
  targetSimulator: E2ESimulator
}): Promise<void> {
  await configureClaudeNode(input.authority, input.targetSimulator)
  const toolUseId = `toolu_fabric_${input.authorityNodeId.replaceAll(/[^a-z0-9]+/gi, '_')}`
  input.targetSimulator.enqueue(anthropicScenario([
    anthropicToolUseExchange({
      label: `approval-${input.authorityNodeId}`,
      toolUseId,
      toolName: 'ExitPlanMode',
      toolInput: { plan: input.planText },
      bodyTextIncludes: input.prompt,
      bodyTextExcludes: 'You are naming a Claude Agent task session',
    }),
  ]))

  const newChat = new NewChatPage(input.page)
  const chat = new ChatPage(input.page)
  const approval = new ApprovalPage(input.page)
  await input.page.goto(topology.webUrl)
  await newChat.openFromNav()
  await newChat.workspaceSelector().click()
  await input.page.locator(`[data-testid="new-chat-workspace-option-${input.workspaceId}"]`).click()
  await newChat.selectRuntime(/Claude Agent/i)
  await newChat.selectProvider(E2E_CLAUDE_AGENT_NAME)
  await newChat.selectPermissionMode(/Approval required|需要审批|Requiere aprobación|承認が必要/i)
  await newChat.fill(input.prompt)
  await newChat.send()
  await approval.waitVisible(60_000)
  await approval.expectContains(/Approval required|需要审批|Requiere aprobación|承認が必要/i)

  input.targetSimulator.enqueue(anthropicScenario([
    anthropicTextExchange({
      label: `approval-complete-${input.authorityNodeId}`,
      text: input.response,
      bodyTextIncludes: toolUseId,
      bodyTextExcludes: 'You are naming a Claude Agent task session',
    }),
  ]))
  await approval.allow()
  await approval.expectHidden(60_000)
  await chat.expectAssistantContains(input.response, 60_000)
  input.targetSimulator.assertExhausted()

  const localSessionId = await chat.sessionId()
  const projection = await json<SessionSummary>(`${input.controller.serverUrl}/sessions/${localSessionId}`)
  expect(projection.execution).toEqual(expect.objectContaining({
    kind: 'node',
    nodeId: input.authorityNodeId,
  }))
}

test.describe('Fabric two-node user journey', () => {
  test.beforeAll(async () => {
    topology = await startFabricTopology()
    const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    const browserExecutable = process.env.CRADLE_E2E_BROWSER_PATH?.trim()
      || (existsSync(systemChrome) ? systemChrome : undefined)
    browser = await chromium.launch({
      headless: !process.env.CRADLE_E2E_HEADED,
      ...(browserExecutable ? { executablePath: browserExecutable } : {}),
    })
    const desktop = await createNodeContext(topology.desktop)
    desktopContext = desktop.context
    desktopPage = desktop.page
    const macbook = await createNodeContext(topology.macbook)
    macbookContext = macbook.context
    macbookPage = macbook.page
    desktopSimulator = await startE2ESimulator({ autoRespond: true })
    macbookSimulator = await startE2ESimulator({ autoRespond: true })
    await Promise.all([
      configureNode(topology.desktop, desktopSimulator),
      configureNode(topology.macbook, macbookSimulator),
    ])
  })

  test.afterAll(async () => {
    await Promise.allSettled([
      desktopSimulator?.close(),
      macbookSimulator?.close(),
      desktopContext?.close(),
      macbookContext?.close(),
      browser?.close(),
    ])
    await topology?.stop()
  })

  test.afterEach(async ({ browserName: _browserName }, testInfo) => {
    if (testInfo.status === testInfo.expectedStatus || !topology) {
      return
    }
    for (const [name, simulator] of [
      ['desktop-simulator-requests.json', desktopSimulator],
      ['macbook-simulator-requests.json', macbookSimulator],
    ] as const) {
      if (simulator) {
        await testInfo.attach(name, {
          body: Buffer.from(JSON.stringify(simulator.requests(), null, 2)),
          contentType: 'application/json',
        })
      }
    }
    for (const [name, path] of [
      ['relayd.log', topology.relayLogPath],
      ['desktop-server.log', topology.desktop.logPath],
      ['macbook-server.log', topology.macbook.logPath],
      ['web.log', topology.webLogPath],
    ] as const) {
      if (existsSync(path)) {
        await testInfo.attach(name, { body: readFileSync(path), contentType: 'text/plain' })
      }
    }
    const simulatorUdid = process.env.CRADLE_E2E_IOS_UDID?.trim()
    if (simulatorUdid) {
      const screenshotPath = join(topology.rootDir, 'mobile-simulator.png')
      try {
        execFileSync('xcrun', ['simctl', 'io', simulatorUdid, 'screenshot', screenshotPath])
        await testInfo.attach('mobile-simulator.png', {
          body: readFileSync(screenshotPath),
          contentType: 'image/png',
        })
      }
      catch {
        // Maestro's own debug bundle remains available when simctl cannot capture the screen.
      }
    }
  })

  test('[CRADLE-FABRIC-001] pairs, mounts, runs Work, approves tools, and reconnects both ways', async () => {
    let desktopLocal!: WorkspaceSummary
    let macbookLocal!: WorkspaceSummary
    let desktopMembership!: FabricMembership
    let macbookMembership!: FabricMembership
    let desktopMountedMac!: WorkspaceSummary
    let macMountedDesktop!: WorkspaceSummary

    await test.step('create one local Workspace on each Node through the UI', async () => {
      const desktopWorkspacePath = mkdtempSync(join(topology.desktop.homeDir, 'workspace-'))
      const macbookWorkspacePath = mkdtempSync(join(topology.macbook.homeDir, 'workspace-'))
      mkdirSync(desktopWorkspacePath, { recursive: true })
      mkdirSync(macbookWorkspacePath, { recursive: true })
      initializeGitWorkspace(desktopWorkspacePath, 'desktop-marker.txt', 'owned by Desktop\n')
      initializeGitWorkspace(macbookWorkspacePath, 'macbook-marker.txt', 'owned by MacBook\n')

      ;[desktopLocal, macbookLocal] = await Promise.all([
        addLocalWorkspace(desktopPage, topology.desktop, desktopWorkspacePath),
        addLocalWorkspace(macbookPage, topology.macbook, macbookWorkspacePath),
      ])
    })

    await test.step('pair Desktop and MacBook through the Nodes UI', async () => {
      ;({ desktopMembership, macbookMembership } = await pairNodesThroughUi())
    })

    await test.step('mount each remote Workspace and read its authority marker', async () => {
      desktopMountedMac = await mountRemoteWorkspace({
        page: desktopPage,
        controller: topology.desktop,
        targetNodeId: macbookMembership.localNodeId,
        remoteWorkspace: macbookLocal,
      })
      macMountedDesktop = await mountRemoteWorkspace({
        page: macbookPage,
        controller: topology.macbook,
        targetNodeId: desktopMembership.localNodeId,
        remoteWorkspace: desktopLocal,
      })

      await expect.poll(async () => {
        const [desktopRead, macbookRead] = await Promise.all([
          json<{ content: string }>(`${topology.desktop.serverUrl}/workspaces/${desktopMountedMac.id}/files/content?path=macbook-marker.txt`),
          json<{ content: string }>(`${topology.macbook.serverUrl}/workspaces/${macMountedDesktop.id}/files/content?path=desktop-marker.txt`),
        ])
        return [desktopRead.content, macbookRead.content]
      }).toEqual(['owned by MacBook\n', 'owned by Desktop\n'])
    })

    await test.step('chat from Desktop in the MacBook Workspace', async () => {
      const desktopProjectionId = await sendChat({
        page: desktopPage,
        workspaceId: desktopMountedMac.id,
        prompt: 'Run this on MacBook',
        response: 'MacBook handled this turn.',
        targetSimulator: macbookSimulator,
      })
      const desktopProjection = await json<SessionSummary>(`${topology.desktop.serverUrl}/sessions/${desktopProjectionId}`)
      expect(desktopProjection.execution).toEqual(expect.objectContaining({
        kind: 'node',
        nodeId: macbookMembership.localNodeId,
      }))
      const remoteMacSessionId = desktopProjection.execution.kind === 'node'
        ? desktopProjection.execution.remoteSessionId
        : ''
      const macAuthority = await json<SessionSummary>(`${topology.macbook.serverUrl}/sessions/${remoteMacSessionId}`)
      expect(macAuthority.execution).toEqual({ kind: 'local' })
    })

    await test.step('chat from MacBook in the Desktop Workspace', async () => {
      const macProjectionId = await sendChat({
        page: macbookPage,
        workspaceId: macMountedDesktop.id,
        prompt: 'Run this on Desktop',
        response: 'Desktop handled this turn.',
        targetSimulator: desktopSimulator,
      })
      const macProjection = await json<SessionSummary>(`${topology.macbook.serverUrl}/sessions/${macProjectionId}`)
      expect(macProjection.execution).toEqual(expect.objectContaining({
        kind: 'node',
        nodeId: desktopMembership.localNodeId,
      }))
    })

    await test.step('create Node-owned Work and continue its conversation in both directions', async () => {
      const desktopWork = await createWork({
        page: desktopPage,
        controller: topology.desktop,
        authority: topology.macbook,
        workspaceId: desktopMountedMac.id,
        authorityNodeId: macbookMembership.localNodeId,
        goal: 'Create this Work on MacBook',
        response: 'MacBook created the managed Worktree.',
        followUp: 'Continue the MacBook Work conversation',
        followUpResponse: 'MacBook continued the Work conversation.',
        targetSimulator: macbookSimulator,
      })
      const macbookWork = await createWork({
        page: macbookPage,
        controller: topology.macbook,
        authority: topology.desktop,
        workspaceId: macMountedDesktop.id,
        authorityNodeId: desktopMembership.localNodeId,
        goal: 'Create this Work on Desktop',
        response: 'Desktop created the managed Worktree.',
        followUp: 'Continue the Desktop Work conversation',
        followUpResponse: 'Desktop continued the Work conversation.',
        targetSimulator: desktopSimulator,
      })
      expect(desktopWork.execution.worktreePath).toContain(topology.macbook.dataDir)
      expect(macbookWork.execution.worktreePath).toContain(topology.desktop.dataDir)
    })

    await test.step('approve remote tool requests in both directions', async () => {
      await approveRemoteToolRequest({
        page: desktopPage,
        controller: topology.desktop,
        authority: topology.macbook,
        workspaceId: desktopMountedMac.id,
        authorityNodeId: macbookMembership.localNodeId,
        prompt: 'Request approval on MacBook',
        planText: 'Run the approved MacBook operation',
        response: 'MacBook continued after approval.',
        targetSimulator: macbookSimulator,
      })
      await approveRemoteToolRequest({
        page: macbookPage,
        controller: topology.macbook,
        authority: topology.desktop,
        workspaceId: macMountedDesktop.id,
        authorityNodeId: desktopMembership.localNodeId,
        prompt: 'Request approval on Desktop',
        planText: 'Run the approved Desktop operation',
        response: 'Desktop continued after approval.',
        targetSimulator: desktopSimulator,
      })
    })

    await test.step('discover conversations created directly on the other Node', async () => {
      const [desktopAuthorityId, macbookAuthorityId] = await Promise.all([
        sendChat({
          page: desktopPage,
          workspaceId: desktopLocal.id,
          prompt: 'Create this conversation on Desktop',
          response: 'This conversation belongs to Desktop.',
          targetSimulator: desktopSimulator,
        }),
        sendChat({
          page: macbookPage,
          workspaceId: macbookLocal.id,
          prompt: 'Create this conversation on MacBook',
          response: 'This conversation belongs to MacBook.',
          targetSimulator: macbookSimulator,
        }),
      ])

      await expect.poll(async () => {
        const [desktopMountedSessions, macMountedSessions] = await Promise.all([
          json<SessionPage>(`${topology.desktop.serverUrl}/sessions/?workspaceId=${desktopMountedMac.id}&archived=false&limit=200`),
          json<SessionPage>(`${topology.macbook.serverUrl}/sessions/?workspaceId=${macMountedDesktop.id}&archived=false&limit=200`),
        ])
        return [
          desktopMountedSessions.items.some(session =>
            session.execution.kind === 'node'
            && session.execution.remoteSessionId === macbookAuthorityId),
          macMountedSessions.items.some(session =>
            session.execution.kind === 'node'
            && session.execution.remoteSessionId === desktopAuthorityId),
        ]
      }, { timeout: 45_000 }).toEqual([true, true])
    })

    await test.step('reconnect both Nodes after relayd restarts', async () => {
      await topology.restartRelay()
      await expect.poll(async () => {
        const nodes = await json<Array<{ status: string }>>(`${topology.desktop.serverUrl}/nodes`)
        return nodes.length === 2 && nodes.every(node => node.status === 'online')
      }, { timeout: 60_000 }).toBe(true)
    })

    await test.step('restore the mounted Workspace after MacBook Server restarts', async () => {
      await topology.restartNode('MacBook')
      await expect.poll(async () => {
        const content = await json<{ content: string }>(
          `${topology.desktop.serverUrl}/workspaces/${desktopMountedMac.id}/files/content?path=macbook-marker.txt`,
        ).catch(() => null)
        return content?.content ?? null
      }, { timeout: 60_000 }).toBe('owned by MacBook\n')
    })

    await test.step('show the same directory after re-enrollment and remove the stale device', async () => {
      const staleNodeId = macbookMembership.localNodeId
      macbookMembership = await rejoinMacbookThroughUi(staleNodeId)

      await expect.poll(async () => {
        const [desktopNodes, macbookNodes] = await Promise.all([
          json<Array<{ nodeId: string }>>(`${topology.desktop.serverUrl}/nodes`),
          json<Array<{ nodeId: string }>>(`${topology.macbook.serverUrl}/nodes`),
        ])
        return [
          desktopNodes.map(node => node.nodeId).sort(),
          macbookNodes.map(node => node.nodeId).sort(),
        ]
      }, { timeout: 45_000 }).toEqual([
        [desktopMembership.localNodeId, macbookMembership.localNodeId, staleNodeId].sort(),
        [desktopMembership.localNodeId, macbookMembership.localNodeId, staleNodeId].sort(),
      ])

      await openNodeSettings(desktopPage)
      await desktopPage.locator(`[data-testid="remove-device-${staleNodeId}"]`).click()
      await expect(desktopPage.locator('[data-testid="remove-device-confirm"]')).toBeVisible()
      await desktopPage.locator('[data-testid="remove-device-confirm"]').click()

      await expect.poll(async () => {
        const [desktopNodes, macbookNodes] = await Promise.all([
          json<Array<{ nodeId: string }>>(`${topology.desktop.serverUrl}/nodes`),
          json<Array<{ nodeId: string }>>(`${topology.macbook.serverUrl}/nodes`),
        ])
        return [
          desktopNodes.map(node => node.nodeId).sort(),
          macbookNodes.map(node => node.nodeId).sort(),
        ]
      }, { timeout: 45_000 }).toEqual([
        [desktopMembership.localNodeId, macbookMembership.localNodeId].sort(),
        [desktopMembership.localNodeId, macbookMembership.localNodeId].sort(),
      ])
    })
  })

  test('[CRADLE-FABRIC-002] enrolls Mobile, switches Nodes, streams Chat, and enforces revocation', async () => {
    test.skip(!mobileIosEnabled, 'Run pnpm e2e:fabric:mobile:ios on macOS to exercise the native app.')
    test.setTimeout(900_000)

    let desktopLocal!: WorkspaceSummary
    let macbookLocal!: WorkspaceSummary
    let desktopMembership!: FabricMembership
    let macbookMembership!: FabricMembership
    let macbookSessionId!: string
    let mobileControllerId!: string
    const macbookSessionTitle = 'Mobile Fabric seeded conversation'

    await test.step('pair two Nodes and create distinct local Workspaces', async () => {
      ;({ desktopMembership, macbookMembership } = await ensurePairedNodes())
      const desktopWorkspacePath = mkdtempSync(join(topology.desktop.homeDir, 'mobile-workspace-'))
      const macbookWorkspacePath = mkdtempSync(join(topology.macbook.homeDir, 'mobile-workspace-'))
      initializeGitWorkspace(desktopWorkspacePath, 'mobile-desktop-marker.txt', 'visible only on Desktop\n')
      initializeGitWorkspace(macbookWorkspacePath, 'mobile-macbook-marker.txt', 'visible only on MacBook\n')
      ;[desktopLocal, macbookLocal] = await Promise.all([
        addLocalWorkspace(desktopPage, topology.desktop, desktopWorkspacePath),
        addLocalWorkspace(macbookPage, topology.macbook, macbookWorkspacePath),
      ])
    })

    await test.step('seed a MacBook conversation and request Mobile Controller access', async () => {
      macbookSessionId = await sendChat({
        page: macbookPage,
        workspaceId: macbookLocal.id,
        prompt: 'Seed the Mobile Fabric conversation',
        response: 'MacBook seeded the Mobile conversation.',
        targetSimulator: macbookSimulator,
      })
      await json<SessionSummary>(`${topology.macbook.serverUrl}/sessions/${macbookSessionId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: macbookSessionTitle }),
      })

      await openNodeSettings(desktopPage)
      const controllerCode = desktopPage.locator('[data-testid="fabric-controller-code"]')
      await expect(controllerCode).toBeVisible()
      const code = (await controllerCode.textContent())?.trim()
      expect(code).toBeTruthy()
      await runMaestroFlow('enroll-controller', { FABRIC_CODE: code! })

      let request: PendingControllerRequest | undefined
      await expect.poll(async () => {
        const requests = await json<PendingControllerRequest[]>(
          `${topology.desktop.serverUrl}/fabric/controller-invitations/requests`,
        )
        request = requests.at(0)
        return request?.requestId ?? null
      }, { timeout: 45_000 }).not.toBeNull()
      mobileControllerId = request!.subjectId

      await expect(desktopPage.locator(`[data-testid="controller-pending-request-${request!.requestId}"]`)).toBeVisible({ timeout: 10_000 })
      await desktopPage.locator(`[data-testid="controller-pending-review-${request!.requestId}"]`).click()
      await desktopPage.locator(`[data-testid="controller-grant-${desktopMembership.localNodeId}-control"]`).click()
      await desktopPage.locator(`[data-testid="controller-grant-${macbookMembership.localNodeId}-control"]`).click()
      await desktopPage.locator('[data-testid="controller-approval-submit"]').click()
      await expect(desktopPage.locator(`[data-testid="controller-pending-request-${request!.requestId}"]`)).toHaveCount(0)
    })

    await test.step('select Desktop and keep Node-scoped Workspace caches isolated', async () => {
      await runMaestroFlow('select-node', {
        NODE_ID: desktopMembership.localNodeId,
        OTHER_WORKSPACE_NAME: macbookLocal.name,
        WORKSPACE_NAME: desktopLocal.name,
      })
    })

    await test.step('switch to MacBook and stream a Chat continuation through Fabric', async () => {
      const prompt = 'Continue this from the native Mobile controller'
      const response = 'MacBook streamed this reply through Fabric to Mobile.'
      macbookSimulator.enqueue(openAiScenario([
        openAiTextExchange({
          label: 'mobile-fabric-follow-up',
          text: response,
          bodyTextIncludes: prompt,
          bodyTextExcludes: 'You are naming a Codex task thread.',
        }),
      ]))
      await runMaestroFlow('switch-node-and-chat', {
        CHAT_PROMPT: prompt,
        CHAT_RESPONSE: response,
        NODE_ID: macbookMembership.localNodeId,
        NODE_NAME: topology.macbook.name,
        OTHER_WORKSPACE_NAME: desktopLocal.name,
        SESSION_TITLE: macbookSessionTitle,
        WORKSPACE_NAME: macbookLocal.name,
      })
      macbookSimulator.assertExhausted()
    })

    await test.step('revoke only MacBook control and remove it from the Mobile picker', async () => {
      const grants = await json<NodeGrant[]>(
        `${topology.desktop.serverUrl}/nodes/${macbookMembership.localNodeId}/grants`,
      )
      const controlGrant = grants.find(grant =>
        grant.controllerId === mobileControllerId && grant.scope === 'control' && !grant.revokedAt)
      expect(controlGrant).toBeTruthy()

      await openNodeSettings(desktopPage)
      await desktopPage.locator(`[data-testid="manage-access-${macbookMembership.localNodeId}"]`).click()
      await desktopPage.locator(`[data-testid="node-grant-remove-${controlGrant!.grantId}"]`).click()
      await desktopPage.locator('[data-testid="revoke-grant-confirm"]').click()
      await expect(desktopPage.locator(`[data-testid="node-grant-remove-${controlGrant!.grantId}"]`)).toHaveCount(0)

      await runMaestroFlow('grant-revoked', {
        REMAINING_NODE_ID: desktopMembership.localNodeId,
        REVOKED_NODE_ID: macbookMembership.localNodeId,
      })
    })

    await test.step('revoke the Controller everywhere and surface the terminal state on Mobile', async () => {
      const grants = await json<NodeGrant[]>(
        `${topology.desktop.serverUrl}/nodes/${desktopMembership.localNodeId}/grants`,
      )
      const controlGrant = grants.find(grant =>
        grant.controllerId === mobileControllerId && grant.scope === 'control' && !grant.revokedAt)
      expect(controlGrant).toBeTruthy()

      await desktopPage.keyboard.press('Escape')
      await expect(desktopPage.getByRole('dialog')).toBeHidden()
      await desktopPage.locator(`[data-testid="manage-access-${desktopMembership.localNodeId}"]`).click()
      await desktopPage.locator(`[data-testid="node-grant-remove-${controlGrant!.grantId}"]`).click()
      await desktopPage.locator('[data-testid="revoke-controller-choice"]').click()
      await desktopPage.locator('[data-testid="revoke-controller-confirm"]').click()
      await expect(desktopPage.locator(`[data-testid="node-grant-remove-${controlGrant!.grantId}"]`)).toHaveCount(0)

      await runMaestroFlow('controller-revoked', {})
    })
  })
})
