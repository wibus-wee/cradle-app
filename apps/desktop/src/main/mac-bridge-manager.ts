/* Manages the cradle-mac-bridge sidecar process for desktop-owned macOS APIs. */
import type { ChildProcess, ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createInterface } from 'node:readline'

import type { MacAppshotCaptureFrontmostWindowRequest, MacAppshotCaptureFrontmostWindowResult, MacAppshotFrontmostContext, MacAppshotProbeTransitionRequest, MacAppshotProbeTransitionResult, MacBridgeRuntimeStatus, MacBridgeStatus, MacCaptureFrontmostWindowRequest, MacCaptureFrontmostWindowResult, MacDisplayRecordingFinishRequest, MacDisplayRecordingFinishResult, MacDisplayRecordingStartRequest, MacDisplayRecordingStartResult, MacHotkeyTriggeredEvent, MacInputConfigureRequest, MacInputConfigureResult, MacInputSyntheticBareModifierRequest, MacInputSyntheticBareModifierResult, MacInputSyntheticBothCommandRequest, MacInputSyntheticBothCommandResult, MacPermissionSettingsRequest, MacPermissionSettingsResult, MacPermissionsRequest, MacPermissionsRequestResult, MacPermissionsStatus, MacScreenCaptureKitDiagnostics, MacWindowRecordingStartRequest } from './mac-bridge-protocol'
import {
  MacAppshotCaptureFrontmostWindowResultSchema,
  MacAppshotFrontmostContextSchema,
  MacAppshotProbeTransitionRequestSchema,
  MacAppshotProbeTransitionResultSchema,
  MacBridgeEventSchema,
  MacBridgeResponseSchema,
  MacBridgeStatusSchema,
  MacCaptureFrontmostWindowResultSchema,
  MacDisplayRecordingFinishRequestSchema,
  MacDisplayRecordingFinishResultSchema,
  MacDisplayRecordingStartRequestSchema,
  MacDisplayRecordingStartResultSchema,
  MacHotkeyTriggeredEventSchema,
  MacInputConfigureResultSchema,
  MacInputSyntheticBareModifierRequestSchema,
  MacInputSyntheticBareModifierResultSchema,
  MacInputSyntheticBothCommandRequestSchema,
  MacInputSyntheticBothCommandResultSchema,
  MacPermissionSettingsResultSchema,
  MacPermissionsRequestResultSchema,
  MacPermissionsStatusSchema,
  MacScreenCaptureKitDiagnosticsSchema,
  MacWindowRecordingStartRequestSchema,
} from './mac-bridge-protocol'
import type { ManagedChildProcess } from './managed-process'
import { spawnManagedProcess } from './managed-process'

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000
const MAC_BRIDGE_RESOURCE_DIR = 'mac-bridge'
const MAC_BRIDGE_BINARY_NAME = 'cradle-mac-bridge'
const WORKSPACE_MARKER_FILE = 'pnpm-workspace.yaml'
const WORKSPACE_SCAN_DEPTH = 12

interface PendingRequest {
  method: string
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

export interface MacBridgeManagerOptions {
  binaryPath?: string | null
  args?: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
  moduleDir?: string
  platform?: NodeJS.Platform
  resourcesPath?: string
  requestTimeoutMs?: number
  spawnProcess?: typeof spawn
}

type MacBridgeEventName = 'hotkeyTriggered'
type MacBridgeChildProcess = ChildProcess | ManagedChildProcess | ChildProcessWithoutNullStreams

function findWorkspaceRoot(anchors: string[]): string | null {
  for (const anchor of anchors) {
    let current = resolve(anchor)
    for (let depth = 0; depth <= WORKSPACE_SCAN_DEPTH; depth += 1) {
      if (existsSync(resolve(current, WORKSPACE_MARKER_FILE))) {
        return current
      }
      const parent = dirname(current)
      if (parent === current) {
        break
      }
      current = parent
    }
  }
  return null
}

export function resolveMacBridgeBinaryPath(options: MacBridgeManagerOptions = {}): string | null {
  if (options.binaryPath) {
    return resolve(options.binaryPath)
  }

  const envPath = options.env?.CRADLE_MAC_BRIDGE_BIN ?? process.env.CRADLE_MAC_BRIDGE_BIN
  if (envPath?.trim()) {
    return resolve(envPath)
  }

  const platform = options.platform ?? process.platform
  if (platform !== 'darwin') {
    return null
  }

  const resourcesPath = options.resourcesPath ?? (process as { resourcesPath?: string }).resourcesPath
  const packagedCandidate = resourcesPath
    ? resolve(resourcesPath, MAC_BRIDGE_RESOURCE_DIR, MAC_BRIDGE_BINARY_NAME)
    : null
  if (packagedCandidate && existsSync(packagedCandidate)) {
    return packagedCandidate
  }

  const workspaceRoot = findWorkspaceRoot([
    options.cwd ?? process.cwd(),
    options.moduleDir ?? __dirname,
  ])
  if (!workspaceRoot) {
    return packagedCandidate
  }

  const packageRoot = resolve(workspaceRoot, 'apps/desktop/native/macos/mac-bridge')
  const candidates = [
    resolve(packageRoot, '.build/cradle-dist', MAC_BRIDGE_BINARY_NAME),
    resolve(packageRoot, '.build/release', MAC_BRIDGE_BINARY_NAME),
    resolve(packageRoot, '.build/debug', MAC_BRIDGE_BINARY_NAME),
  ]
  return candidates.find(candidate => existsSync(candidate)) ?? candidates[0]!
}

function createBridgeError(message: string, code = 'mac-bridge-error', details?: unknown): Error {
  const error = new Error(message) as Error & { details?: unknown }
  error.name = code
  if (details !== undefined) {
    error.details = details
  }
  return error
}

function readBinarySignature(binaryPath: string | null): string | null {
  if (!binaryPath) {
    return null
  }
  try {
    const stat = statSync(binaryPath)
    return `${binaryPath}:${stat.size}:${stat.mtimeMs}`
  }
  catch {
    return null
  }
}

export class MacBridgeManager {
  private readonly events = new EventEmitter()
  private readonly options: Required<Pick<MacBridgeManagerOptions, 'args' | 'requestTimeoutMs'>> & MacBridgeManagerOptions
  private readonly pendingRequests = new Map<string, PendingRequest>()
  private child: MacBridgeChildProcess | null = null
  private nextRequestId = 1
  private startedAt: string | null = null
  private lastError: string | null = null
  private binaryPath: string | null = null
  private stoppingChild: MacBridgeChildProcess | null = null
  private runningBinaryPath: string | null = null
  private runningBinarySignature: string | null = null

  constructor(options: MacBridgeManagerOptions = {}) {
    this.options = {
      ...options,
      args: options.args ?? [],
      requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    }
    this.binaryPath = resolveMacBridgeBinaryPath(this.options)
  }

  getStatus(): MacBridgeRuntimeStatus {
    const platform = this.options.platform ?? process.platform
    const binaryPath = this.binaryPath ?? resolveMacBridgeBinaryPath(this.options)
    return {
      available: platform === 'darwin' && !!binaryPath && existsSync(binaryPath),
      running: this.child !== null && this.child.exitCode === null,
      platform,
      binaryPath,
      pid: this.child ? readManagedTargetPid(this.child) : null,
      startedAt: this.startedAt,
      lastError: this.lastError,
    }
  }

  async start(): Promise<MacBridgeRuntimeStatus> {
    if (this.child && this.child.exitCode === null) {
      const status = this.getStatus()
      const currentSignature = readBinarySignature(status.binaryPath)
      if (status.binaryPath === this.runningBinaryPath && currentSignature === this.runningBinarySignature) {
        return status
      }
      console.debug('[mac-bridge] restarting after binary changed:', {
        previousBinaryPath: this.runningBinaryPath,
        nextBinaryPath: status.binaryPath,
      })
      await this.stop()
    }

    const status = this.getStatus()
    if (!status.available || !status.binaryPath) {
      this.lastError = status.platform === 'darwin'
        ? 'cradle-mac-bridge binary is not available'
        : `Mac Bridge is unsupported on ${status.platform}`
      return this.getStatus()
    }

    const child = this.options.spawnProcess
      ? this.options.spawnProcess(status.binaryPath, this.options.args, {
          cwd: this.options.cwd,
          env: this.options.env ?? process.env,
          stdio: 'pipe',
        }) as ChildProcessWithoutNullStreams
      : spawnManagedProcess({
          kind: 'spawn',
          command: status.binaryPath,
          args: this.options.args,
          cwd: this.options.cwd,
          env: this.options.env ?? process.env,
          stdin: 'pipe',
          shutdownGraceMs: 2_000,
        })

    if (!child.stdout || !child.stderr || !child.stdin) {
      throw createBridgeError('Mac Bridge process did not expose stdio pipes', 'mac-bridge-stdio-unavailable')
    }

    this.child = child
    this.startedAt = new Date().toISOString()
    this.lastError = null
    this.runningBinaryPath = status.binaryPath
    this.runningBinarySignature = readBinarySignature(status.binaryPath)
    console.debug('[mac-bridge] started:', {
      binaryPath: status.binaryPath,
      pid: readManagedTargetPid(child),
    })

    const stdout = createInterface({ input: child.stdout })
    stdout.on('line', line => this.handleStdoutLine(line))
    child.stderr.on('data', (data: Buffer) => {
      console.warn(`[mac-bridge] ${data.toString().trim()}`)
    })
    child.once('error', (error) => {
      this.lastError = error.message
      this.rejectAllPending(error)
    })
    child.once('exit', (code, signal) => {
      const intentionallyStopped = this.stoppingChild === child
      this.stoppingChild = null
      this.lastError = intentionallyStopped || (code === 0 && !signal)
        ? this.lastError
        : `cradle-mac-bridge exited with code=${code} signal=${signal}`
      this.child = null
      this.startedAt = null
      this.runningBinaryPath = null
      this.runningBinarySignature = null
      stdout.close()
      this.rejectAllPending(createBridgeError(this.lastError ?? 'cradle-mac-bridge exited', 'mac-bridge-exited'))
    })

    return this.getStatus()
  }

  async stop(): Promise<void> {
    const child = this.child
    if (!child) {
      return
    }

    this.child = null
    this.startedAt = null
    this.runningBinaryPath = null
    this.runningBinarySignature = null
    this.stoppingChild = child
    this.rejectAllPending(createBridgeError('Mac Bridge stopped', 'mac-bridge-stopped'))

    await new Promise<void>((resolveStop) => {
      let finished = false
      let forceTimer: NodeJS.Timeout | null = null
      const finish = () => {
        if (finished) {
          return
        }
        finished = true
        if (forceTimer) {
          clearTimeout(forceTimer)
        }
        resolveStop()
      }
      child.once('exit', finish)
      child.once('error', finish)
      if (child.exitCode !== null || child.signalCode !== null) {
        finish()
        return
      }
      stopMacBridgeChild(child, 'SIGTERM')
      forceTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          stopMacBridgeChild(child, 'SIGKILL')
        }
        finish()
      }, 2_000)
    })
  }

  async request<T>(method: string, params?: unknown, options: { timeoutMs?: number } = {}): Promise<T> {
    const status = await this.start()
    const child = this.child
    if (!status.running || !child?.stdin?.writable) {
      throw createBridgeError(status.lastError ?? 'Mac Bridge is not running', 'mac-bridge-unavailable')
    }
    const stdin = child.stdin

    const id = String(this.nextRequestId++)
    const timeoutMs = options.timeoutMs ?? this.options.requestTimeoutMs
    return await new Promise<T>((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id)
        rejectRequest(createBridgeError(`Mac Bridge request timed out: ${method}`, 'mac-bridge-timeout'))
      }, timeoutMs)
      this.pendingRequests.set(id, {
        method,
        resolve: value => resolveRequest(value as T),
        reject: rejectRequest,
        timer,
      })
      stdin.write(`${JSON.stringify({ id, method, params })}\n`)
    })
  }

  async readBridgeStatus(): Promise<MacBridgeStatus> {
    const result = await this.request<unknown>('bridge.status')
    return MacBridgeStatusSchema.parse(result)
  }

  async readPermissions(): Promise<MacPermissionsStatus> {
    const result = await this.request<unknown>('mac.permissions.status')
    return MacPermissionsStatusSchema.parse(result)
  }

  async requestPermissions(params: MacPermissionsRequest = {}): Promise<MacPermissionsRequestResult> {
    const result = await this.request<unknown>('mac.permissions.request', params)
    return MacPermissionsRequestResultSchema.parse(result)
  }

  async openPermissionSettings(params: MacPermissionSettingsRequest = {}): Promise<MacPermissionSettingsResult> {
    const result = await this.request<unknown>('mac.permissions.openSettings', params)
    return MacPermissionSettingsResultSchema.parse(result)
  }

  async configureInput(params: MacInputConfigureRequest): Promise<MacInputConfigureResult> {
    const result = await this.request<unknown>('mac.input.configure', params)
    return MacInputConfigureResultSchema.parse(result)
  }

  async synthesizeBothCommandHotkey(
    params: MacInputSyntheticBothCommandRequest = {},
  ): Promise<MacInputSyntheticBothCommandResult> {
    const parsedParams = MacInputSyntheticBothCommandRequestSchema.parse(params)
    const result = await this.request<unknown>('mac.input.syntheticBothCommand', parsedParams, { timeoutMs: 5_000 })
    return MacInputSyntheticBothCommandResultSchema.parse(result)
  }

  async synthesizeBareModifierHotkey(
    params: MacInputSyntheticBareModifierRequest,
  ): Promise<MacInputSyntheticBareModifierResult> {
    const parsedParams = MacInputSyntheticBareModifierRequestSchema.parse(params)
    const result = await this.request<unknown>('mac.input.syntheticBareModifier', parsedParams, { timeoutMs: 5_000 })
    return MacInputSyntheticBareModifierResultSchema.parse(result)
  }

  async captureFrontmostWindow(params: MacCaptureFrontmostWindowRequest): Promise<MacCaptureFrontmostWindowResult> {
    const result = await this.request<unknown>('mac.capture.frontmostWindow', params, { timeoutMs: 30_000 })
    return MacCaptureFrontmostWindowResultSchema.parse(result)
  }

  async captureAppshotFrontmostWindow(
    params: MacAppshotCaptureFrontmostWindowRequest,
  ): Promise<MacAppshotCaptureFrontmostWindowResult> {
    const result = await this.request<unknown>('mac.appshot.captureFrontmostWindow', params, { timeoutMs: 30_000 })
    return MacAppshotCaptureFrontmostWindowResultSchema.parse(result)
  }

  async readAppshotFrontmostContext(): Promise<MacAppshotFrontmostContext> {
    const result = await this.request<unknown>('mac.appshot.frontmostContext')
    return MacAppshotFrontmostContextSchema.parse(result)
  }

  async probeAppshotTransitionVisibility(
    params: MacAppshotProbeTransitionRequest,
  ): Promise<MacAppshotProbeTransitionResult> {
    const parsedParams = MacAppshotProbeTransitionRequestSchema.parse(params)
    const result = await this.request<unknown>('mac.appshot.probeTransitionVisibility', parsedParams, { timeoutMs: 30_000 })
    return MacAppshotProbeTransitionResultSchema.parse(result)
  }

  async probeAppshotTransitionPresentation(
    params: MacAppshotProbeTransitionRequest,
  ): Promise<MacAppshotProbeTransitionResult> {
    const parsedParams = MacAppshotProbeTransitionRequestSchema.parse(params)
    const result = await this.request<unknown>('mac.appshot.probeTransitionPresentation', parsedParams, { timeoutMs: 30_000 })
    return MacAppshotProbeTransitionResultSchema.parse(result)
  }

  async readScreenCaptureKitDiagnostics(): Promise<MacScreenCaptureKitDiagnostics> {
    const result = await this.request<unknown>('mac.screenCaptureKit.diagnostics', {}, { timeoutMs: 12_000 })
    return MacScreenCaptureKitDiagnosticsSchema.parse(result)
  }

  async startDisplayRecording(params: MacDisplayRecordingStartRequest): Promise<MacDisplayRecordingStartResult> {
    const parsedParams = MacDisplayRecordingStartRequestSchema.parse(params)
    const result = await this.request<unknown>('mac.recording.startDisplay', parsedParams, { timeoutMs: 12_000 })
    return MacDisplayRecordingStartResultSchema.parse(result)
  }

  async finishDisplayRecording(params: MacDisplayRecordingFinishRequest): Promise<MacDisplayRecordingFinishResult> {
    const parsedParams = MacDisplayRecordingFinishRequestSchema.parse(params)
    const result = await this.request<unknown>('mac.recording.finishDisplay', parsedParams, { timeoutMs: 12_000 })
    return MacDisplayRecordingFinishResultSchema.parse(result)
  }

  async startWindowRecording(params: MacWindowRecordingStartRequest): Promise<MacDisplayRecordingStartResult> {
    const parsedParams = MacWindowRecordingStartRequestSchema.parse(params)
    const result = await this.request<unknown>('mac.recording.startWindow', parsedParams, { timeoutMs: 12_000 })
    return MacDisplayRecordingStartResultSchema.parse(result)
  }

  async finishWindowRecording(params: MacDisplayRecordingFinishRequest): Promise<MacDisplayRecordingFinishResult> {
    const parsedParams = MacDisplayRecordingFinishRequestSchema.parse(params)
    const result = await this.request<unknown>('mac.recording.finishWindow', parsedParams, { timeoutMs: 12_000 })
    return MacDisplayRecordingFinishResultSchema.parse(result)
  }

  on(eventName: MacBridgeEventName, handler: (event: MacHotkeyTriggeredEvent) => void): () => void {
    this.events.on(eventName, handler)
    return () => this.events.off(eventName, handler)
  }

  private handleStdoutLine(line: string): void {
    if (!line.trim()) {
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    }
    catch (error) {
      this.lastError = `invalid Mac Bridge JSON: ${error instanceof Error ? error.message : String(error)}`
      return
    }

    const response = MacBridgeResponseSchema.safeParse(parsed)
    if (response.success && this.pendingRequests.has(response.data.id)) {
      this.handleResponse(response.data.id, response.data.result, response.data.error)
      return
    }

    const event = MacBridgeEventSchema.safeParse(parsed)
    if (event.success) {
      this.handleEvent(event.data.method, event.data.params)
    }
  }

  private handleResponse(id: string, result: unknown, error: unknown): void {
    const pending = this.pendingRequests.get(id)
    if (!pending) {
      return
    }
    this.pendingRequests.delete(id)
    clearTimeout(pending.timer)
    if (error) {
      const parsed = typeof error === 'object' && error && 'message' in error
        ? error as { code?: string, message?: string, details?: unknown }
        : null
      pending.reject(createBridgeError(
        parsed?.message ?? `Mac Bridge request failed: ${pending.method}`,
        parsed?.code,
        parsed?.details,
      ))
      return
    }
    pending.resolve(result)
  }

  private handleEvent(method: string, params: unknown): void {
    if (method.startsWith('event.mac.input')) {
      const log = method === 'event.mac.inputMonitorSetupFailed' || method === 'event.mac.inputMonitorDisabled'
        ? console.warn
        : console.debug
      log('[mac-bridge] input event:', method, params)
      return
    }
    if (method !== 'event.mac.hotkeyTriggered') {
      console.debug('[mac-bridge] ignored event:', method, params)
      return
    }
    const event = MacHotkeyTriggeredEventSchema.safeParse(params)
    if (event.success) {
      console.debug('[mac-bridge] hotkey triggered:', event.data)
      this.events.emit('hotkeyTriggered', event.data)
      return
    }
    console.warn('[mac-bridge] hotkey event payload rejected:', event.error, params)
  }

  private rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer)
      pending.reject(error)
      this.pendingRequests.delete(id)
    }
  }
}

function readManagedTargetPid(child: MacBridgeChildProcess): number | null {
  return 'targetPid' in child ? child.targetPid ?? child.pid ?? null : child.pid ?? null
}

function stopMacBridgeChild(child: MacBridgeChildProcess, signal: NodeJS.Signals): void {
  if ('stop' in child && signal === 'SIGTERM') {
    void child.stop(signal)
    return
  }
  child.kill(signal)
}
