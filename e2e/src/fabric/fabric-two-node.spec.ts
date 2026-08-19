import { execFileSync } from 'node:child_process'
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
  authority: FabricNodeProcess
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
})
