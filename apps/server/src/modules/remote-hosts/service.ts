import { randomUUID } from 'node:crypto'

import type { RemoteHost } from '@cradle/db'
import { remoteHosts } from '@cradle/db'
import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { AppError } from '../../errors/app-error'
import { db } from '../../infra'
import {
  buildRemoteCradleSshLaunchConfig,
  startRemoteCradleServerTunnel,
  type RemoteCradleServerTunnelHandle,
} from './cradle-server-tunnel'
import {
  createRemoteCradleClient,
  type RemoteCradleClient,
  type RemoteCradleServerHealthPayload,
  type RemoteWorkspaceFileContent,
  type RemoteWorkspaceFileEntry,
  type RemoteWorkspaceFileInfo,
  type RemoteWorkspaceView,
} from './remote-cradle-client'

export interface CreateRemoteHostInput {
  id?: string
  displayName: string
  enabled?: boolean
  connectionConfig?: RemoteHostConnectionConfigInput
  capabilities?: RemoteHostCapabilitiesInput
}

export interface UpdateRemoteHostInput {
  displayName?: string
  enabled?: boolean
  connectionConfig?: RemoteHostConnectionConfigInput
  capabilities?: RemoteHostCapabilitiesInput
}

export type RemoteHostTransport = 'ssh' | 'direct-url'

export interface RemoteHostSshProfileInput {
  hostName: string
  user?: string | null
  port?: number | null
  auth?: 'default' | 'identityFile'
  identityFilePath?: string | null
}

export interface RemoteHostSshProfile {
  hostName: string
  user: string | null
  port: number | null
  auth: 'default' | 'identityFile'
  identityFilePath: string | null
}

export interface RemoteHostConnectionConfigInput {
  transport?: RemoteHostTransport
  baseUrl?: string
  ssh?: RemoteHostSshProfileInput
  sshExecutable?: string
  sshArgs?: string[]
  connectTimeoutMs?: number
}

export interface RemoteHostCradleServerCapabilityInput {
  enabled?: boolean
  remoteHost?: string
  remotePort?: number
}

export interface RemoteHostCapabilitiesInput {
  cradleServer?: RemoteHostCradleServerCapabilityInput
}

export interface SshProfileLaunchConfig {
  sshTarget: string
  sshArgs: string[]
}

export type RemoteHostConnectionState = 'idle' | 'connected' | 'offline'

export interface RemoteHostView extends RemoteHost {
  connectionState: RemoteHostConnectionState
  lastError: string | null
}

export interface RemoteCradleServerConnectionView {
  hostId: string
  state: RemoteHostConnectionState
  localBaseUrl: string | null
  lastError: string | null
}

export interface RemoteCradleServerHealthView extends RemoteCradleServerConnectionView {
  status: 'ok'
  health: RemoteCradleServerHealthPayload
}

interface RemoteHostConnectionRecord {
  host: RemoteHost
  tunnel: RemoteCradleServerTunnelHandle | null
  baseUrl: string
  lastError: string | null
  tunnelExited: boolean
}

interface RemoteHostCradleServerCapability {
  enabled: boolean
  remoteHost: string
  remotePort: number
}

interface RemoteHostCapabilities {
  cradleServer: RemoteHostCradleServerCapability
}

interface NormalizedRemoteHostConnection {
  connectionConfigJson: string
  capabilitiesJson: string
}

interface RemoteHostConnectionPatch {
  connectionConfig?: RemoteHostConnectionConfigInput
  capabilities?: RemoteHostCapabilitiesInput
}

const nonBlankStringSchema = z.string().trim().min(1)
const transportSchema = z.enum(['ssh', 'direct-url'])
const sshAuthSchema = z.enum(['default', 'identityFile'])

const sshProfileSchema = z.object({
  hostName: nonBlankStringSchema,
  user: nonBlankStringSchema.nullable().optional(),
  port: z.number().int().min(1).max(65_535).nullable().optional(),
  auth: sshAuthSchema.default('default'),
  identityFilePath: nonBlankStringSchema.nullable().optional(),
}).superRefine((profile, ctx) => {
  if (profile.auth === 'identityFile' && !profile.identityFilePath) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['identityFilePath'],
      message: 'identityFilePath is required when SSH auth is identityFile.',
    })
  }
  if (profile.auth === 'default' && profile.identityFilePath) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['identityFilePath'],
      message: 'identityFilePath can only be set when SSH auth is identityFile.',
    })
  }
}).transform(profile => ({
  hostName: profile.hostName,
  user: profile.user ?? null,
  port: profile.port ?? null,
  auth: profile.auth,
  identityFilePath: profile.auth === 'identityFile' ? profile.identityFilePath ?? null : null,
}))

const connectionConfigSchema = z.object({
  transport: transportSchema.optional(),
  baseUrl: nonBlankStringSchema.optional(),
  ssh: sshProfileSchema.optional(),
  sshExecutable: nonBlankStringSchema.optional(),
  sshArgs: z.array(z.string()).optional(),
  connectTimeoutMs: z.number().int().positive().max(120_000).optional(),
}).passthrough().superRefine((config, ctx) => {
  const transport = config.transport ?? 'ssh'
  if (transport === 'ssh' && !config.ssh) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['ssh'],
      message: 'ssh is required when transport is ssh.',
    })
  }
  if (transport === 'direct-url' && !config.baseUrl) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['baseUrl'],
      message: 'baseUrl is required when transport is direct-url.',
    })
  }
}).transform(config => ({
  ...config,
  transport: config.transport ?? 'ssh',
}))

type RemoteHostConnectionConfig = z.infer<typeof connectionConfigSchema>

const cradleServerCapabilitySchema = z.object({
  enabled: z.boolean().default(true),
  remoteHost: nonBlankStringSchema.default('127.0.0.1'),
  remotePort: z.number().int().min(1).max(65_535).default(21_423),
}).transform(cradleServer => ({
  enabled: cradleServer.enabled,
  remoteHost: cradleServer.remoteHost,
  remotePort: cradleServer.remotePort,
}))

const capabilitiesSchema = z.object({
  cradleServer: cradleServerCapabilitySchema.default({
    enabled: true,
    remoteHost: '127.0.0.1',
    remotePort: 21_423,
  }),
}).passthrough().transform(capabilities => ({
  cradleServer: capabilities.cradleServer,
}))

const connections = new Map<string, RemoteHostConnectionRecord>()
const connectPromises = new Map<string, Promise<RemoteCradleServerConnectionView>>()

export const connectRemoteHost = connectRemoteHostCradleServer
export const disconnectRemoteHost = disconnectRemoteHostCradleServer
export const buildSshProfileLaunchConfig = buildRemoteCradleSshLaunchConfig

export function listRemoteHosts(): RemoteHostView[] {
  return db()
    .select()
    .from(remoteHosts)
    .orderBy(asc(remoteHosts.displayName), asc(remoteHosts.id))
    .all()
    .map(toHostView)
}

export function readRemoteHost(hostId: string): RemoteHostView {
  return toHostView(requireRemoteHost(hostId))
}

export function createRemoteHost(input: CreateRemoteHostInput): RemoteHostView {
  const now = currentUnixSeconds()
  const normalized = normalizeRemoteHostConnection(input, null)
  const row = db()
    .insert(remoteHosts)
    .values({
      id: input.id ?? randomUUID(),
      displayName: input.displayName.trim(),
      enabled: input.enabled ?? true,
      connectionConfigJson: normalized.connectionConfigJson,
      capabilitiesJson: normalized.capabilitiesJson,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get()
  return toHostView(row)
}

export function updateRemoteHost(hostId: string, patch: UpdateRemoteHostInput): RemoteHostView {
  const current = requireRemoteHost(hostId)
  const update: Partial<typeof remoteHosts.$inferInsert> = {
    updatedAt: currentUnixSeconds(),
  }
  if (patch.displayName !== undefined) {
    update.displayName = patch.displayName.trim()
  }
  if (patch.enabled !== undefined) {
    update.enabled = patch.enabled
  }
  if (hasConnectionPatch(patch)) {
    const normalized = normalizeRemoteHostConnection(patch, current)
    update.connectionConfigJson = normalized.connectionConfigJson
    update.capabilitiesJson = normalized.capabilitiesJson
  }

  const row = db()
    .update(remoteHosts)
    .set(update)
    .where(eq(remoteHosts.id, hostId))
    .returning()
    .get()
  return toHostView(row)
}

export async function deleteRemoteHost(hostId: string): Promise<void> {
  await disconnectRemoteHostCradleServer(hostId)
  db()
    .delete(remoteHosts)
    .where(eq(remoteHosts.id, hostId))
    .run()
}

export async function connectRemoteHostCradleServer(hostId: string): Promise<RemoteCradleServerConnectionView> {
  const existingPromise = connectPromises.get(hostId)
  if (existingPromise) {
    return existingPromise
  }
  const promise = connectRemoteHostCradleServerInner(hostId).finally(() => {
    connectPromises.delete(hostId)
  })
  connectPromises.set(hostId, promise)
  return promise
}

export async function disconnectRemoteHostCradleServer(hostId: string): Promise<void> {
  const record = connections.get(hostId)
  connections.delete(hostId)
  await record?.tunnel?.close()
}

export async function readRemoteHostCradleServerHealth(hostId: string): Promise<RemoteCradleServerHealthView> {
  const record = await connectedRecord(hostId)
  const health = await fetchRemoteCradleServerHealth(record)
  return {
    ...toConnectionView(record),
    status: 'ok',
    health,
  }
}

export async function testRemoteHostCradleServer(hostId: string): Promise<RemoteCradleServerHealthView> {
  await disconnectRemoteHostCradleServer(hostId)
  await connectRemoteHostCradleServer(hostId)
  return await readRemoteHostCradleServerHealth(hostId)
}

export async function listRemoteCradleWorkspaces(hostId: string): Promise<RemoteWorkspaceView[]> {
  return await (await remoteCradleClient(hostId, 'list remote workspaces')).listWorkspaces()
}

export async function listRemoteCradleWorkspaceFiles(
  hostId: string,
  remoteWorkspaceId: string,
): Promise<RemoteWorkspaceFileEntry[]> {
  return await (await remoteCradleClient(hostId, 'list remote workspace files')).listWorkspaceFiles(remoteWorkspaceId)
}

export async function listRemoteCradleWorkspaceFileChildren(
  hostId: string,
  remoteWorkspaceId: string,
  relativePath: string,
): Promise<RemoteWorkspaceFileEntry[]> {
  return await (await remoteCradleClient(hostId, 'list remote workspace children'))
    .listWorkspaceFileChildren(remoteWorkspaceId, relativePath)
}

export async function readRemoteCradleWorkspaceFileContent(
  hostId: string,
  remoteWorkspaceId: string,
  relativePath: string,
): Promise<RemoteWorkspaceFileContent> {
  return await (await remoteCradleClient(hostId, 'read remote workspace file'))
    .readWorkspaceFileContent(remoteWorkspaceId, relativePath)
}

export async function readRemoteCradleWorkspaceFileInfo(
  hostId: string,
  remoteWorkspaceId: string,
  relativePath: string,
): Promise<RemoteWorkspaceFileInfo | null> {
  return await (await remoteCradleClient(hostId, 'read remote workspace file info'))
    .readWorkspaceFileInfo(remoteWorkspaceId, relativePath)
}

export async function resolveRemoteWorkspaceByPath(hostId: string, remotePath: string): Promise<RemoteWorkspaceView | null> {
  const workspaces = await listRemoteCradleWorkspaces(hostId)
  return workspaces.find(workspace => workspace.locator.path === remotePath) ?? null
}

async function remoteCradleClient(hostId: string, _operation: string): Promise<RemoteCradleClient> {
  const record = await connectedRecord(hostId)
  return createRemoteCradleClient(record.baseUrl)
}

async function connectedRecord(hostId: string): Promise<RemoteHostConnectionRecord> {
  const record = connections.get(hostId)
  if (record && !record.tunnelExited) {
    return record
  }
  await connectRemoteHostCradleServer(hostId)
  const next = connections.get(hostId)
  if (!next || next.tunnelExited) {
    throw new AppError({
      code: 'remote_cradle_server_not_connected',
      status: 503,
      message: 'Remote Cradle Server is not connected.',
      details: { hostId },
    })
  }
  return next
}

async function connectRemoteHostCradleServerInner(hostId: string): Promise<RemoteCradleServerConnectionView> {
  const host = requireRemoteHost(hostId)
  if (!host.enabled) {
    throw new AppError({
      code: 'remote_host_disabled',
      status: 409,
      message: 'Remote host is disabled.',
      details: { hostId },
    })
  }

  await disconnectRemoteHostCradleServer(hostId)

  const connectionConfig = parseConnectionConfig(host.connectionConfigJson)
  const capabilities = parseCapabilities(host.capabilitiesJson)
  if (!capabilities.cradleServer.enabled) {
    throw new AppError({
      code: 'remote_cradle_server_capability_disabled',
      status: 409,
      message: 'Remote Cradle Server capability is disabled.',
      details: { hostId },
    })
  }

  let tunnel: RemoteCradleServerTunnelHandle | null = null
  let record: RemoteHostConnectionRecord | null = null
  try {
    let baseUrl: string
    if (connectionConfig.transport === 'direct-url') {
      baseUrl = normalizeBaseUrl(connectionConfig.baseUrl ?? '')
    }
    else {
      tunnel = await startSshCradleTunnel(host, connectionConfig, capabilities)
      baseUrl = tunnel.localBaseUrl
    }

    record = {
      host,
      tunnel,
      baseUrl,
      lastError: null,
      tunnelExited: false,
    }
    tunnel?.onExit((exit) => {
      if (!record) {
        return
      }
      record.tunnelExited = true
      record.lastError = `ssh tunnel exited with code ${exit.code ?? 'null'} signal ${exit.signal ?? 'null'}`
    })
    connections.set(hostId, record)
    await fetchRemoteCradleServerHealth(record)
    return toConnectionView(record)
  }
  catch (error) {
    await tunnel?.close()
    const appError = toAppError(error, 'remote_cradle_server_connect_failed')
    connections.set(hostId, {
      host,
      tunnel: null,
      baseUrl: connectionConfig.transport === 'direct-url' ? connectionConfig.baseUrl ?? '' : '',
      lastError: appError.message,
      tunnelExited: true,
    })
    throw appError
  }
}

async function startSshCradleTunnel(
  host: RemoteHost,
  connectionConfig: RemoteHostConnectionConfig,
  capabilities: RemoteHostCapabilities,
): Promise<RemoteCradleServerTunnelHandle> {
  if (!connectionConfig.ssh) {
    throw new AppError({
      code: 'remote_cradle_server_ssh_required',
      status: 400,
      message: 'SSH profile is required when remote host transport is ssh.',
      details: { hostId: host.id },
    })
  }
  const sshLaunch = resolveHostSshLaunchConfig(connectionConfig)
  return await startRemoteCradleServerTunnel({
    hostId: host.id,
    sshTarget: sshLaunch.sshTarget,
    sshExecutable: connectionConfig.sshExecutable,
    sshArgs: [...sshLaunch.sshArgs, ...(connectionConfig.sshArgs ?? [])],
    remoteHost: capabilities.cradleServer.remoteHost,
    remotePort: capabilities.cradleServer.remotePort,
    readyTimeoutMs: connectionConfig.connectTimeoutMs ?? 10_000,
  })
}

async function fetchRemoteCradleServerHealth(record: RemoteHostConnectionRecord): Promise<RemoteCradleServerHealthPayload> {
  if (record.tunnelExited) {
    throw new AppError({
      code: 'remote_cradle_server_offline',
      status: 503,
      message: 'Remote Cradle Server connection is not connected.',
      details: { hostId: record.host.id },
    })
  }
  try {
    return await createRemoteCradleClient(record.baseUrl).readHealth()
  }
  catch (error) {
    record.lastError = error instanceof Error ? error.message : String(error)
    throw toAppError(error, 'remote_cradle_server_health_failed')
  }
}

function resolveHostSshLaunchConfig(connectionConfig: RemoteHostConnectionConfig): SshProfileLaunchConfig {
  if (!connectionConfig.ssh) {
    throw new AppError({
      code: 'remote_host_ssh_profile_required',
      status: 400,
      message: 'Remote host SSH profile is required.',
    })
  }
  return buildRemoteCradleSshLaunchConfig(connectionConfig.ssh)
}

function toHostView(host: RemoteHost): RemoteHostView {
  const record = connections.get(host.id)
  return {
    ...host,
    connectionState: record ? connectionStateOf(record) : 'idle',
    lastError: record?.lastError ?? null,
  }
}

function toConnectionView(record: RemoteHostConnectionRecord): RemoteCradleServerConnectionView {
  return {
    hostId: record.host.id,
    state: connectionStateOf(record),
    localBaseUrl: record.tunnelExited ? null : record.baseUrl,
    lastError: record.lastError,
  }
}

function connectionStateOf(record: RemoteHostConnectionRecord): RemoteHostConnectionState {
  return record.tunnelExited ? 'offline' : 'connected'
}

function requireRemoteHost(hostId: string): RemoteHost {
  const host = db()
    .select()
    .from(remoteHosts)
    .where(eq(remoteHosts.id, hostId))
    .get()
  if (!host) {
    throw new AppError({
      code: 'remote_host_not_found',
      status: 404,
      message: 'Remote host was not found.',
      details: { hostId },
    })
  }
  return host
}

function normalizeRemoteHostConnection(
  input: RemoteHostConnectionPatch,
  current: RemoteHost | null,
): NormalizedRemoteHostConnection {
  const currentConnectionConfig = current ? parseConnectionConfig(current.connectionConfigJson) : {}
  const currentCapabilities = current ? parseCapabilities(current.capabilitiesJson) : {}
  const connectionConfig = parseConnectionConfig(JSON.stringify({
    ...currentConnectionConfig,
    ...(input.connectionConfig ?? {}),
  }))
  const capabilities = parseCapabilities(JSON.stringify(mergeCapabilities(currentCapabilities, input.capabilities)))
  return {
    connectionConfigJson: JSON.stringify(connectionConfig),
    capabilitiesJson: JSON.stringify(capabilities),
  }
}

function mergeCapabilities(
  current: Partial<RemoteHostCapabilities>,
  input?: RemoteHostCapabilitiesInput,
): RemoteHostCapabilitiesInput {
  return {
    cradleServer: {
      ...(current.cradleServer ?? {}),
      ...(input?.cradleServer ?? {}),
    },
  }
}

function parseConnectionConfig(raw: string): RemoteHostConnectionConfig {
  return connectionConfigSchema.parse(JSON.parse(raw || '{}'))
}

function parseCapabilities(raw: string): RemoteHostCapabilities {
  return capabilitiesSchema.parse(JSON.parse(raw || '{}'))
}

function normalizeBaseUrl(raw: string): string {
  const value = raw.trim().replace(/\/+$/, '')
  if (!value) {
    throw new AppError({
      code: 'remote_cradle_base_url_required',
      status: 400,
      message: 'Remote Cradle Server base URL is required for direct-url transport.',
    })
  }
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('Remote Cradle Server base URL must use http or https.')
    }
    return url.toString().replace(/\/+$/, '')
  }
  catch (error) {
    throw new AppError({
      code: 'remote_cradle_base_url_invalid',
      status: 400,
      message: error instanceof Error ? error.message : String(error),
      details: { baseUrl: raw },
    })
  }
}

function hasConnectionPatch(patch: UpdateRemoteHostInput): boolean {
  return patch.connectionConfig !== undefined || patch.capabilities !== undefined
}

function currentUnixSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function toAppError(error: unknown, fallbackCode: string): AppError {
  if (error instanceof AppError) {
    return error
  }
  return new AppError({
    code: fallbackCode,
    status: 503,
    message: error instanceof Error ? error.message : String(error),
  })
}
