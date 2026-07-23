import { sessions, worktrees } from '@cradle/db'
import { eq } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import type { ProviderSessionBinding } from '../../helpers/agent-runtime-config'
import {
  SessionRuntimeConfigJsonSchema,
  writeProviderSessionBindingToSessionConfig,
} from '../../helpers/agent-runtime-config'
import { db } from '../../infra'
import type { ResolvedRootBoundary } from '../../security/path-boundary'
import {
  assertWithinAllowedRoots,
  resolveDirectoryBoundarySync,
} from '../../security/path-boundary'
import { getCradleHarnessSystemInstructions } from '../chat-runtime/harness/system-instructions'
import { reportRuntimeSessionTitle } from '../chat-runtime/title-service'
import { runtimeUsesAgentTerminalLaunch } from '../provider-contracts/runtime-compatibility'
import * as SessionService from '../session/service'
import * as Workspace from '../workspace/service'
import { resolveSessionExecutionRootById } from '../worktree/service'
import { captureCodexCliSession } from './codex-session-capture'
import {
  deleteTerminalHistory,
  readTerminalHistory,
  terminalHistoryEnabled,
  writeTerminalHistory,
} from './history'
import { captureKimiCliSession } from './kimi-session-capture'
import type { CliTuiLaunchMode } from './launch-planner'
import { isOfficialProviderSource, planCliTuiLaunch } from './launch-planner'
import type { PtyClientEvent, PtyRestoreInfo } from './protocol'
import type { PtyRuntimeRole } from './pty.runtime'
import { PtyRuntimeRegistry } from './pty.runtime'
import type { PtyLiveSocket } from './pty.socket'
import { PtySocketHub } from './pty.socket'
import { ptyTimeline } from './pty.timeline'
import { getDefaultShell } from './pty-platform'

const providerCaptureTimers = new Map<string, ReturnType<typeof setTimeout>>()
const shellLeaseTimers = new Map<string, ReturnType<typeof setTimeout>>()
const shellSocketCounts = new Map<string, number>()
const pendingTitleOscBuffers = new Map<string, string>()
const PROVIDER_CAPTURE_ATTEMPTS = 120
const PROVIDER_CAPTURE_RETRY_MS = 500
const MAX_OSC_LOOKBEHIND_CHARS = 1_000
const OSC_SEQUENCE_RE = /\u001B\](\d+);([^\u0007\u001B]*(?:\u001B(?!\\)[^\u0007\u001B]*)*)(?:\u0007|\u001B\\)/g
const TITLE_OSC_CODES = new Set(['0', '2'])

const lastRestoreBySession = new Map<string, PtyRestoreInfo>()

const ptyRuntime = new PtyRuntimeRegistry({
  onOutput: (sessionId, role, data) => {
    ptyTimeline.appendOutput(sessionId, data)
    publishCliTuiTitle(sessionId, role, data)
  },
  onExit: (sessionId, exit) => {
    pendingTitleOscBuffers.delete(sessionId)
    persistTimelineHistory(sessionId)
    ptyTimeline.appendExit(sessionId, exit)
  },
  onRelease: (sessionId) => {
    pendingTitleOscBuffers.delete(sessionId)
    lastRestoreBySession.delete(sessionId)
    ptyTimeline.delete(sessionId)
  },
})

const ptySocketHub = new PtySocketHub(ptyRuntime, ptyTimeline)

function shellLeaseMs(): number {
  const parsed = Number(process.env.CRADLE_PTY_SHELL_LEASE_MS)
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed
  }
  return 30_000
}

function cancelShellLease(ptyId: string): void {
  const timer = shellLeaseTimers.get(ptyId)
  if (!timer) {
    return
  }
  clearTimeout(timer)
  shellLeaseTimers.delete(ptyId)
}

function scheduleShellLeaseExpiry(ptyId: string): void {
  cancelShellLease(ptyId)
  const timer = setTimeout(() => {
    shellLeaseTimers.delete(ptyId)
    if ((shellSocketCounts.get(ptyId) ?? 0) > 0) {
      return
    }
    ptyRuntime.destroy(ptyId)
  }, shellLeaseMs())
  timer.unref?.()
  shellLeaseTimers.set(ptyId, timer)
}

function attachShellSocket(ptyId: string): void {
  cancelShellLease(ptyId)
  shellSocketCounts.set(ptyId, (shellSocketCounts.get(ptyId) ?? 0) + 1)
}

function detachShellSocket(ptyId: string): void {
  const nextCount = Math.max(0, (shellSocketCounts.get(ptyId) ?? 1) - 1)
  if (nextCount > 0) {
    shellSocketCounts.set(ptyId, nextCount)
    return
  }
  shellSocketCounts.delete(ptyId)
  scheduleShellLeaseExpiry(ptyId)
}

SessionService.onSessionCleanup((sessionId) => {
  cancelProviderSessionCapture(sessionId)
  persistTimelineHistory(sessionId)
  deleteTerminalHistory(sessionId)
  ptyRuntime.destroy(sessionId)
})

SessionService.onSessionArchived((sessionId) => {
  destroyPtySession(sessionId)
  deleteTerminalHistory(sessionId)
})

export interface TerminalSessionContext {
  session: TerminalSessionRecord
  workspacePath: string
}

interface TerminalSessionRecord {
  id: string
  workspaceId: string | null
  providerTargetId: string | null
  runtimeKind: string
  configJson: string
  ptyStartedAt: number | null
}

function getSession(sessionId: string): TerminalSessionRecord | undefined {
  return db()
    .select({
      id: sessions.id,
      workspaceId: sessions.workspaceId,
      providerTargetId: sessions.providerTargetId,
      runtimeKind: sessions.runtimeKind,
      configJson: sessions.configJson,
      ptyStartedAt: sessions.ptyStartedAt,
    })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .get()
}

function getTerminalContext(sessionId: string): TerminalSessionContext | null {
  const session = getSession(sessionId)
  if (!session) {
    return null
  }

  const execution = resolveSessionExecutionRootById(sessionId)
  if (execution?.worktreeId && !execution.isIsolated) {
    throw new AppError({
      code: 'worktree_unavailable',
      status: 409,
      message: 'Isolated checkout is unavailable. Repair or leave isolation before opening a terminal.',
      details: {
        sessionId,
        worktreeId: execution.worktreeId,
        worktreeHealth: execution.worktreeHealth ?? 'missing',
      },
    })
  }
  const workspacePath = execution?.rootPath
    || (session.workspaceId ? Workspace.getLocalWorkspacePath(session.workspaceId) : null)
  if (!workspacePath) {
    return null
  }

  return { session, workspacePath }
}

function requireSession(sessionId: string): TerminalSessionRecord {
  const session = getSession(sessionId)
  if (!session) {
    throw new AppError({
      code: 'terminal_session_not_found',
      status: 404,
      message: 'Chat session not found',
      details: { sessionId },
    })
  }
  return session
}

function requireTerminalContext(sessionId: string): TerminalSessionContext {
  const context = getTerminalContext(sessionId)
  if (!context) {
    throw new AppError({
      code: 'terminal_session_not_found',
      status: 404,
      message: 'Chat session not found',
      details: { sessionId },
    })
  }
  return context
}

function requireTimelineSession(sessionId: string, message: string): void {
  if (!ptyTimeline.hasSession(sessionId)) {
    throw new AppError({ code: 'terminal_not_found', status: 404, message, details: { sessionId } })
  }
}

export function startOrAttach(input: { sessionId: string, cols: number, rows: number }): {
  sessionId: string
  running: boolean
  mode: CliTuiLaunchMode
  agent?: string
  restore?: PtyRestoreInfo
} {
  const context = requireTerminalContext(input.sessionId)
  if (!runtimeUsesAgentTerminalLaunch(context.session.runtimeKind ?? 'standard')) {
    throw new AppError({
      code: 'terminal_profile_not_supported',
      status: 409,
      message: 'Terminal runtime only supports agent terminal sessions',
      details: { sessionId: input.sessionId, runtimeKind: context.session.runtimeKind },
    })
  }

  const sessionConfig = SessionRuntimeConfigJsonSchema.parse(context.session.configJson)
  const config = sessionConfig.cliTuiLaunch
  if (!config) {
    throw new AppError({
      code: 'terminal_launch_config_missing',
      status: 409,
      message: 'Terminal launch configuration is missing for this session',
      details: { sessionId: input.sessionId },
    })
  }

  const running = ptyRuntime.isRunning(input.sessionId)
  const plan = planCliTuiLaunch({
    sessionId: input.sessionId,
    executable: config.executable,
    args: config.args,
    env: config.env,
    running,
    ptyStartedAt: context.session.ptyStartedAt,
    workspacePath: context.workspacePath,
    providerSession: sessionConfig.providerSession,
    codexCliSession: sessionConfig.codexCliSession,
    harnessSystemPrompt: getCradleHarnessSystemInstructions(),
  })

  if (plan.mode !== 'live-attach') {
    ptyTimeline.reset(input.sessionId)
    pendingTitleOscBuffers.delete(input.sessionId)
  }

  // Native agent resume wins over durable screen history. History only seeds
  // cold fresh spawns so reconnects do not invent a prior conversation.
  let restore: PtyRestoreInfo = {
    mode: plan.mode,
    agent: plan.agent === 'generic' ? undefined : plan.agent,
  }
  if (plan.mode === 'fresh') {
    const history = readTerminalHistory(input.sessionId)
    if (history?.ansi) {
      ptyTimeline.seedBuffer(input.sessionId, history.ansi)
      restore = {
        mode: 'history',
        agent: plan.agent === 'generic' ? undefined : plan.agent,
        reason: 'seeded durable terminal history before fresh launch',
      }
    }
  }

  ptyTimeline.setRestore(input.sessionId, restore)
  lastRestoreBySession.set(input.sessionId, restore)

  const startedAt = Date.now()
  ptyRuntime.ensureSession({
    sessionId: input.sessionId,
    role: 'cli-tui',
    executable: plan.executable,
    args: plan.args,
    cwd: context.workspacePath,
    cols: input.cols,
    rows: input.rows,
    env: {
      ...plan.env,
      CRADLE_CHAT_SESSION_ID: input.sessionId,
      CRADLE_TUI_LAUNCH_MODE: plan.mode,
      ...(context.session.workspaceId ? { CRADLE_WORKSPACE_ID: context.session.workspaceId } : {}),
    },
  })

  if (!context.session.ptyStartedAt) {
    db()
      .update(sessions)
      .set({ ptyStartedAt: Math.floor(Date.now() / 1000) })
      .where(eq(sessions.id, input.sessionId))
      .run()
  }

  if (plan.needsCapture && plan.captureDriver) {
    scheduleProviderSessionCapture({
      sessionId: input.sessionId,
      workspacePath: context.workspacePath,
      startedAt,
      agent: plan.agent,
      captureDriver: plan.captureDriver,
      env: plan.env,
    })
  }

  return {
    sessionId: input.sessionId,
    running: ptyRuntime.isRunning(input.sessionId),
    mode: plan.mode,
    ...(plan.agent !== 'generic' ? { agent: plan.agent } : {}),
    restore,
  }
}

export function getHost(sessionId: string) {
  const context = requireTerminalContext(sessionId)
  if (!runtimeUsesAgentTerminalLaunch(context.session.runtimeKind ?? 'standard')) {
    throw new AppError({
      code: 'terminal_profile_not_supported',
      status: 409,
      message: 'Host snapshot only applies to agent terminal sessions',
      details: { sessionId, runtimeKind: context.session.runtimeKind },
    })
  }

  const running = ptyRuntime.isRunning(sessionId)
  const hasTimeline = ptyTimeline.hasSession(sessionId)
  const restore = lastRestoreBySession.get(sessionId) ?? null
  const provider = getProviderSession(sessionId).providerSession
  const history = readTerminalHistory(sessionId)

  return {
    sessionId,
    role: 'cli-tui' as const,
    running,
    phase: running
      ? 'running' as const
      : hasTimeline
        ? 'exited' as const
        : 'absent' as const,
    mode: restore?.mode ?? null,
    agent: restore?.agent ?? provider?.agent ?? null,
    workspacePath: context.workspacePath,
    ptyStartedAt: context.session.ptyStartedAt,
    providerSession: provider,
    historyEnabled: terminalHistoryEnabled(),
    hasHistory: Boolean(history?.ansi),
  }
}

export function openChatSocket(input: {
  sessionId: string
  fromSeq?: number
  ws: PtyLiveSocket
}): void {
  requireSession(input.sessionId)
  requireTimelineSession(input.sessionId, 'Terminal session not found')
  ptySocketHub.open(input.ws, {
    channelId: input.sessionId,
    fromSeq: input.fromSeq,
  })
}

export function rejectSocket(ws: PtyLiveSocket, error: unknown): void {
  ptySocketHub.reject(ws, error)
}

export function handleSocketMessage(ws: PtyLiveSocket, event: PtyClientEvent): void {
  ptySocketHub.handleMessage(ws, event)
}

export function closeSocket(ws: PtyLiveSocket): void {
  ptySocketHub.close(ws)
}

export function stop(sessionId: string): void {
  requireSession(sessionId)
  cancelProviderSessionCapture(sessionId)
  persistTimelineHistory(sessionId)
  ptyRuntime.destroy(sessionId)
}

export function getProviderSession(sessionId: string): {
  sessionId: string
  providerSession: ProviderSessionBinding | null
} {
  const context = requireTerminalContext(sessionId)
  const config = SessionRuntimeConfigJsonSchema.parse(context.session.configJson)
  return {
    sessionId,
    providerSession: config.providerSession
      ?? (config.codexCliSession
        ? {
            source: 'cradle:codex',
            agent: 'codex',
            kind: 'id' as const,
            value: config.codexCliSession.sessionId,
            workspacePath: config.codexCliSession.workspacePath,
            capturedAt: config.codexCliSession.capturedAt,
            startedAt: config.codexCliSession.startedAt,
            sourcePath: config.codexCliSession.sourcePath,
            confidence: 'exact' as const,
          }
        : null),
  }
}

export function reportProviderSession(input: {
  sessionId: string
  source: string
  agent: string
  kind?: 'id' | 'path'
  value: string
  sourcePath?: string
  confidence?: 'exact' | 'heuristic'
}): {
  sessionId: string
  providerSession: ProviderSessionBinding
} {
  const context = requireTerminalContext(input.sessionId)
  if (!runtimeUsesAgentTerminalLaunch(context.session.runtimeKind ?? 'standard')) {
    throw new AppError({
      code: 'terminal_profile_not_supported',
      status: 409,
      message: 'Provider session bindings only apply to agent terminal sessions',
      details: { sessionId: input.sessionId, runtimeKind: context.session.runtimeKind },
    })
  }

  if (!isOfficialProviderSource(input.source, input.agent)) {
    throw new AppError({
      code: 'terminal_provider_session_invalid',
      status: 400,
      message: 'Provider session source/agent pair is not supported',
      details: { source: input.source, agent: input.agent },
    })
  }

  const kind = input.kind ?? 'id'
  if (kind === 'path' && !input.value.startsWith('/')) {
    throw new AppError({
      code: 'terminal_provider_session_invalid',
      status: 400,
      message: 'Provider session path bindings must be absolute',
      details: { value: input.value },
    })
  }

  if (input.value.split('').some(char => char.charCodeAt(0) < 32)) {
    throw new AppError({
      code: 'terminal_provider_session_invalid',
      status: 400,
      message: 'Provider session value contains control characters',
    })
  }

  const now = Math.floor(Date.now() / 1000)
  const binding: ProviderSessionBinding = {
    source: input.source,
    agent: input.agent,
    kind,
    value: input.value,
    workspacePath: context.workspacePath,
    capturedAt: now,
    startedAt: context.session.ptyStartedAt ?? now,
    ...(input.sourcePath ? { sourcePath: input.sourcePath } : {}),
    confidence: input.confidence ?? 'exact',
  }

  db()
    .update(sessions)
    .set({
      configJson: writeProviderSessionBindingToSessionConfig({
        configJson: context.session.configJson,
        binding,
      }),
    })
    .where(eq(sessions.id, input.sessionId))
    .run()

  return { sessionId: input.sessionId, providerSession: binding }
}

export function clearProviderSession(sessionId: string): {
  sessionId: string
  providerSession: null
} {
  const context = requireTerminalContext(sessionId)
  const config = SessionRuntimeConfigJsonSchema.parse(context.session.configJson)
  if (!config.providerSession && !config.codexCliSession) {
    return { sessionId, providerSession: null }
  }

  const { providerSession: _providerSession, codexCliSession: _codexCliSession, ...rest } = config
  db()
    .update(sessions)
    .set({ configJson: JSON.stringify(rest) })
    .where(eq(sessions.id, sessionId))
    .run()

  return { sessionId, providerSession: null }
}

export function startShell(input: { ptyId: string, cwd: string, cols: number, rows: number }) {
  const cwd = resolveShellCwd(input.cwd)
  if (!ptyRuntime.isRunning(input.ptyId)) {
    ptyTimeline.reset(input.ptyId)
  }

  ptyRuntime.ensureSession({
    sessionId: input.ptyId,
    role: 'bottom-panel',
    executable: getDefaultShell(),
    args: [],
    cwd,
    cols: input.cols,
    rows: input.rows,
  })

  return { ptyId: input.ptyId, running: ptyRuntime.isRunning(input.ptyId) }
}

function resolveShellCwd(cwd: string): string {
  const target = resolveDirectoryBoundarySync(cwd, { cwd })
  const roots = getShellAllowedRoots()
  assertWithinAllowedRoots({
    target,
    roots,
    code: 'terminal_shell_cwd_outside_allowed_roots',
    message: 'Shell cwd is outside allowed roots',
    details: { allowedRoots: roots.map(root => root.requestedPath) },
  })
  return target.requestedPath
}

function getShellAllowedRoots(): ResolvedRootBoundary[] {
  const workspaceRoots = Workspace.list()
    .filter(workspace => workspace.locator.hostId === 'local')
    .map(workspace => workspace.locator.path)
  const worktreeRoots = db()
    .select({ path: worktrees.path })
    .from(worktrees)
    .where(eq(worktrees.status, 'active'))
    .all()
    .map(worktree => worktree.path)

  const roots: ResolvedRootBoundary[] = []
  const seen = new Set<string>()
  for (const candidate of [...workspaceRoots, ...worktreeRoots]) {
    try {
      const root = resolveDirectoryBoundarySync(candidate, { root: candidate })
      if (!seen.has(root.realPath)) {
        seen.add(root.realPath)
        roots.push(root)
      }
    }
    catch {
      // Ignore stale workspace or worktree records.
    }
  }
  return roots
}

export function openShellSocket(input: {
  ptyId: string
  fromSeq?: number
  ws: PtyLiveSocket
}): void {
  requireTimelineSession(input.ptyId, 'Shell session not found')
  attachShellSocket(input.ptyId)
  ptySocketHub.open(input.ws, {
    channelId: input.ptyId,
    fromSeq: input.fromSeq,
    onClose: () => detachShellSocket(input.ptyId),
  })
}

export function shellStop(ptyId: string): void {
  cancelShellLease(ptyId)
  shellSocketCounts.delete(ptyId)
  ptyRuntime.destroy(ptyId)
}

export function destroyPtySession(sessionId: string): void {
  cancelProviderSessionCapture(sessionId)
  persistTimelineHistory(sessionId)
  ptyRuntime.destroy(sessionId)
}

function persistTimelineHistory(sessionId: string): void {
  const buffer = ptyTimeline.getBuffer(sessionId)
  if (buffer) {
    writeTerminalHistory(sessionId, buffer)
  }
}

export function shutdownPtyModule(): void {
  for (const timer of providerCaptureTimers.values()) {
    clearTimeout(timer)
  }
  providerCaptureTimers.clear()
  for (const timer of shellLeaseTimers.values()) {
    clearTimeout(timer)
  }
  shellLeaseTimers.clear()
  shellSocketCounts.clear()
  ptySocketHub.clear()
  ptyRuntime.destroyAll()
  ptyTimeline.clear()
}

export async function listResources() {
  const terminals = await ptyRuntime.snapshotResources()
  const totals = terminals.reduce(
    (acc, item) => {
      if (item.rssMB !== null) {
        if (item.role === 'cli-tui') {
          acc.cliTuiRssMB += item.rssMB
        }
 else {
          acc.bottomPanelRssMB += item.rssMB
        }
      }

      if (item.cpuPercent !== null) {
        if (item.role === 'cli-tui') {
          acc.cliTuiCpuPercent += item.cpuPercent
        }
 else {
          acc.bottomPanelCpuPercent += item.cpuPercent
        }
      }

      return acc
    },
    {
      cliTuiRssMB: 0,
      bottomPanelRssMB: 0,
      cliTuiCpuPercent: 0,
      bottomPanelCpuPercent: 0,
    },
  )

  return {
    terminals,
    totals: {
      cliTuiRssMB: Math.round(totals.cliTuiRssMB * 100) / 100,
      bottomPanelRssMB: Math.round(totals.bottomPanelRssMB * 100) / 100,
      cliTuiCpuPercent: Math.round(totals.cliTuiCpuPercent * 100) / 100,
      bottomPanelCpuPercent: Math.round(totals.bottomPanelCpuPercent * 100) / 100,
    },
    timestamp: Date.now(),
  }
}

function scheduleProviderSessionCapture(input: {
  sessionId: string
  workspacePath: string
  startedAt: number
  agent: string
  captureDriver: 'codex-filesystem' | 'kimi-filesystem'
  env?: Record<string, string>
}): void {
  cancelProviderSessionCapture(input.sessionId)
  let attempts = 0

  const runCapture = async () => {
    attempts += 1
    try {
      const captured = input.captureDriver === 'codex-filesystem'
        ? await captureCodexCliSession({
            workspacePath: input.workspacePath,
            startedAt: input.startedAt,
            env: input.env,
          })
        : await captureKimiCliSession({
            workspacePath: input.workspacePath,
            startedAt: input.startedAt,
            env: input.env,
          })
      const binding = captured
        ? {
            source: `cradle:${input.agent}`,
            agent: input.agent,
            kind: 'id' as const,
            value: captured.sessionId,
            workspacePath: captured.workspacePath,
            capturedAt: captured.capturedAt,
            startedAt: captured.startedAt,
            sourcePath: captured.sourcePath,
            confidence: 'exact' as const,
          } satisfies ProviderSessionBinding
        : null
      if (binding) {
        persistProviderSessionBinding(input.sessionId, binding)
        if (captured?.title) {
          void reportRuntimeSessionTitle({
            sessionId: input.sessionId,
            title: captured.title,
          }).catch(() => {})
          providerCaptureTimers.delete(input.sessionId)
          return
        }
      }
    }
    catch {
      // Capture is opportunistic; a failed scan should not break the PTY session.
    }

    if (attempts >= PROVIDER_CAPTURE_ATTEMPTS) {
      providerCaptureTimers.delete(input.sessionId)
      return
    }

    const timer = setTimeout(() => {
      void runCapture()
    }, PROVIDER_CAPTURE_RETRY_MS)
    providerCaptureTimers.set(input.sessionId, timer)
  }

  void runCapture()
}

function cancelProviderSessionCapture(sessionId: string): void {
  const timer = providerCaptureTimers.get(sessionId)
  if (!timer) {
    return
  }

  clearTimeout(timer)
  providerCaptureTimers.delete(sessionId)
}

function publishCliTuiTitle(sessionId: string, role: PtyRuntimeRole, data: string): void {
  if (role !== 'cli-tui') {
    return
  }

  const pending = pendingTitleOscBuffers.get(sessionId) ?? ''
  if (!pending && !data.includes('\u001B]')) {
    return
  }

  const input = `${pending}${data}`
  const title = readTerminalTitle(input)
  const nextPending = getPendingOscSuffix(input)
  if (nextPending) {
    pendingTitleOscBuffers.set(sessionId, nextPending)
  }
  else {
    pendingTitleOscBuffers.delete(sessionId)
  }

  if (!title) {
    return
  }

  void reportRuntimeSessionTitle({ sessionId, title }).catch(() => {
    // Runtime title sync is best-effort; PTY output delivery must not depend on DB writes.
  })
}

function readTerminalTitle(input: string): string | null {
  let title: string | null = null
  OSC_SEQUENCE_RE.lastIndex = 0
  let match: RegExpExecArray | null = OSC_SEQUENCE_RE.exec(input)

  while (match !== null) {
    const code = match[1]!
    const value = (match[2] ?? '').trim()
    if (value && TITLE_OSC_CODES.has(code)) {
      title = value
    }
    match = OSC_SEQUENCE_RE.exec(input)
  }

  return title
}

function getPendingOscSuffix(data: string): string {
  const oscStart = data.lastIndexOf('\u001B]')
  if (oscStart === -1) {
    return ''
  }

  const suffix = data.slice(oscStart)
  if (suffix.includes('\u0007') || suffix.includes('\u001B\\')) {
    return ''
  }

  return suffix.slice(-MAX_OSC_LOOKBEHIND_CHARS)
}

function persistProviderSessionBinding(
  sessionId: string,
  binding: ProviderSessionBinding,
): void {
  const session = getSession(sessionId)
  if (!session) {
    return
  }
  const existing = SessionRuntimeConfigJsonSchema.parse(session.configJson).providerSession
  if (existing?.agent === binding.agent && existing.value === binding.value && existing.workspacePath === binding.workspacePath) {
    return
  }

  db()
    .update(sessions)
    .set({
      configJson: writeProviderSessionBindingToSessionConfig({
        configJson: session.configJson,
        binding,
      }),
    })
    .where(eq(sessions.id, sessionId))
    .run()
}
