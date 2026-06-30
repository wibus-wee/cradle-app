import { createHmac, randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  agentCredentials,
  messages,
  providerTargets,
  remoteHosts,
  remoteHostAgentdSessionLinks,
  workspaces,
} from '@cradle/db'
import {
  encodeRemoteAgentFrame,
  parseRemoteAgentFrame,
  REMOTE_AGENT_PROTOCOL_VERSION,
  type AgentStartParams,
  type RemoteAgentFrame,
  type RemoteAgentSummary,
  type RemoteAgentTurnParams,
} from '@cradle/remote-agent-protocol'
import {
  encodeRelayEnvelope,
  parseRelayEnvelope,
  type RelayEnvelope,
} from '@cradle/remote-relay-protocol'
import type { UIMessage } from 'ai'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'

import { createServerApp } from '../src/app'
import { db, shutdownInfra } from '../src/infra'
import { getRuntimeRegistry } from '../src/modules/chat-runtime/chat-runtime-provider-registry'
import { createRemoteMockProvider } from '../src/modules/chat-runtime-providers/remote-mock/provider'
import { mintRelayToken } from '../src/modules/relay-servers/relay-token-service'
import { buildSshProfileLaunchConfig } from '../src/modules/remote-hosts/service'

type ElysiaApp = Awaited<ReturnType<typeof createServerApp>>

const defaultDevRelayHMACSecret = 'cradle-dev-relay-insecure-secret-do-not-use-in-production'

interface FakeDaemonServer {
  socketPath: string
  close(): Promise<void>
}

interface FakeRelayServer {
  url: string
  close(): Promise<void>
}

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function restoreEnv(name: string, previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = previousValue
}

function expectRelayTokenSignedByDevSecret(rawToken: string) {
  const parts = rawToken.split('.')
  expect(parts).toHaveLength(3)
  const [header, payload, signature] = parts as [string, string, string]
  expect(createHmac('sha256', defaultDevRelayHMACSecret).update(`${header}.${payload}`).digest('base64url')).toBe(signature)
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
}

async function createAppWithDataDir(dataDir: string): Promise<ElysiaApp> {
  process.env.CRADLE_DATA_DIR = dataDir
  const app = await createServerApp()
  const registry = getRuntimeRegistry()
  if (!registry.get('remote-mock')) {
    registry.register(createRemoteMockProvider({
      readSecret: () => '',
    }))
  }
  return app
}

describe('remote hosts', () => {
  let fakeDaemon: FakeDaemonServer | null = null
  let fakeRelay: FakeRelayServer | null = null

  afterEach(async () => {
    await fakeDaemon?.close()
    fakeDaemon = null
    await fakeRelay?.close()
    fakeRelay = null
    shutdownInfra()
  })

  it('builds OpenSSH launch config from a structured SSH profile', () => {
    expect(buildSshProfileLaunchConfig({
      hostName: '127.0.0.1',
      user: 'me',
      port: 2222,
      auth: 'identityFile',
      identityFilePath: '/tmp/cradle-test-key',
    })).toEqual({
      sshTarget: 'me@127.0.0.1',
      sshArgs: ['-p', '2222', '-i', '/tmp/cradle-test-key'],
    })

    expect(buildSshProfileLaunchConfig({
      hostName: 'devbox',
      user: null,
      port: null,
      auth: 'default',
      identityFilePath: null,
    })).toEqual({
      sshTarget: 'devbox',
      sshArgs: [],
    })
  })

  it('stores host registry rows without writing provider targets', async () => {
    const dataDir = makeTempDir('cradle-remote-hosts-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    let app: ElysiaApp | undefined

    try {
      app = await createAppWithDataDir(dataDir)
      expect(db().select().from(providerTargets).all()).toHaveLength(0)

      const createRes = await app.handle(new Request('http://localhost/remote-hosts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'remote-host-a',
          displayName: 'Remote Host A',
          connectionConfig: {
            transport: 'direct-socket',
            localSocketPath: '/tmp/cradle-agentd-test.sock',
          },
          capabilities: {
            agentd: { remoteSocketPath: '/home/me/.cradle/agentd/agent.sock' },
          },
        }),
      }))
      expect(createRes.status).toBe(200)
      expect(await createRes.json()).toEqual(expect.objectContaining({
        id: 'remote-host-a',
        displayName: 'Remote Host A',
        connectionState: 'idle',
      }))

      const patchRes = await app.handle(new Request('http://localhost/remote-hosts/remote-host-a', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ displayName: 'Remote Host Renamed' }),
      }))
      expect(patchRes.status).toBe(200)
      expect(await patchRes.json()).toEqual(expect.objectContaining({
        displayName: 'Remote Host Renamed',
      }))

      const listRes = await app.handle(new Request('http://localhost/remote-hosts'))
      expect(listRes.status).toBe(200)
      expect(await listRes.json()).toEqual([
        expect.objectContaining({ id: 'remote-host-a' }),
      ])
      expect(db().select().from(providerTargets).all()).toHaveLength(0)

      const deleteRes = await app.handle(new Request('http://localhost/remote-hosts/remote-host-a', {
        method: 'DELETE',
      }))
      expect(deleteRes.status).toBe(200)
      expect(await deleteRes.json()).toEqual({ ok: true })
      expect(await (await app.handle(new Request('http://localhost/remote-hosts'))).json()).toEqual([])
      expect(db().select().from(providerTargets).all()).toHaveLength(0)
    }
    finally {
      rmSync(dataDir, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
    }
  })

  it('stores structured SSH profiles as remote host config without writing provider targets', async () => {
    const dataDir = makeTempDir('cradle-remote-hosts-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    let app: ElysiaApp | undefined

    try {
      app = await createAppWithDataDir(dataDir)
      expect(db().select().from(providerTargets).all()).toHaveLength(0)

      const createRes = await app.handle(new Request('http://localhost/remote-hosts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'remote-host-ssh-profile',
          displayName: 'SSH Profile Host',
          connectionConfig: {
            ssh: {
              hostName: '127.0.0.1',
              user: 'me',
              port: 2222,
              auth: 'identityFile',
              identityFilePath: '/tmp/cradle-test-key',
            },
            connectTimeoutMs: 5_000,
          },
        }),
      }))
      expect(createRes.status).toBe(200)
      const created = await createRes.json() as {
        connectionConfigJson: string
        capabilitiesJson: string
      }
      expect(JSON.parse(created.connectionConfigJson)).toEqual({
        transport: 'ssh',
        ssh: {
          hostName: '127.0.0.1',
          user: 'me',
          port: 2222,
          auth: 'identityFile',
          identityFilePath: '/tmp/cradle-test-key',
        },
        connectTimeoutMs: 5_000,
      })
      expect(JSON.parse(created.capabilitiesJson)).toEqual(expect.objectContaining({
        agentd: expect.objectContaining({
          remoteSocketPath: '~/.cradle/agentd/agent.sock',
        }),
      }))
      expect(db().select().from(providerTargets).all()).toHaveLength(0)
    }
    finally {
      rmSync(dataDir, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
    }
  })

  it('creates a pending relay host without an ssh target or relay config', async () => {
    const dataDir = makeTempDir('cradle-remote-hosts-pending-relay-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    let app: ElysiaApp | undefined

    try {
      app = await createAppWithDataDir(dataDir)

      // A relay host starts "pending": only a name and transport=relay. No SSH
      // profile is required, and the relay coordinates are filled in later by
      // the pairing flow.
      const createRes = await app.handle(new Request('http://localhost/remote-hosts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'remote-host-pending-relay',
          displayName: 'Pending relay host',
          enabled: true,
          connectionConfig: { transport: 'relay' },
        }),
      }))
      expect(createRes.status).toBe(200)
      const created = await createRes.json() as {
        connectionConfigJson: string
      }
      expect(JSON.parse(created.connectionConfigJson)).toEqual({ transport: 'relay' })
      expect(db().select().from(providerTargets).all()).toHaveLength(0)
    }
    finally {
      rmSync(dataDir, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
    }
  })

  it('mints relay pairing tokens without writing provider targets', async () => {
    const dataDir = makeTempDir('cradle-remote-hosts-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousCredentialSecret = process.env.CRADLE_CREDENTIAL_SECRET
    const previousRelaySecret = process.env.CRADLE_RELAY_HMAC_SECRET
    const previousRelayDevSecret = process.env.CRADLE_RELAYD_DEV_HMAC_SECRET
    let app: ElysiaApp | undefined

    try {
      process.env.CRADLE_CREDENTIAL_SECRET = 'remote-relay-credential-secret'
      delete process.env.CRADLE_RELAY_HMAC_SECRET
      delete process.env.CRADLE_RELAYD_DEV_HMAC_SECRET
      app = await createAppWithDataDir(dataDir)
      await createRemoteHost(app, {
        hostId: 'remote-host-relay-token',
        socketPath: '/tmp/cradle-agentd-relay-token.sock',
      })

      const tokenRes = await app.handle(new Request('http://localhost/remote-hosts/remote-host-relay-token/relay/pairing-token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          relayUrl: 'http://127.0.0.1:8787',
          ttlMs: 60_000,
        }),
      }))
      expect(tokenRes.status).toBe(200)
      const token = await tokenRes.json() as {
        relayUrl: string
        pairingToken: string
        hostToken: string
        roomId: string
        enrollmentId: string
        enrollmentSecret: string
      }
      expect(token).toEqual(expect.objectContaining({
        relayUrl: 'http://127.0.0.1:8787',
        pairingToken: expect.any(String),
        hostToken: expect.any(String),
        roomId: expect.stringMatching(/^room_/),
        enrollmentId: expect.any(String),
        enrollmentSecret: expect.stringMatching(/^cradle_relay_enroll_/),
      }))
      expect(expectRelayTokenSignedByDevSecret(token.pairingToken)).toEqual(expect.objectContaining({
        aud: 'cradle-relay',
        iss: 'cradle-server',
        purpose: 'pairing_start',
        roomId: token.roomId,
      }))
      expect(expectRelayTokenSignedByDevSecret(token.hostToken)).toEqual(expect.objectContaining({
        aud: 'cradle-relay',
        iss: 'cradle-server',
        purpose: 'ws',
        role: 'host',
        roomId: token.roomId,
      }))
      expect(db().select().from(providerTargets).all()).toHaveLength(0)
      const relayConfig = JSON.parse(db()
        .select()
        .from(remoteHosts)
        .where(eq(remoteHosts.id, 'remote-host-relay-token'))
        .get()?.connectionConfigJson ?? '{}').relay
      expect(relayConfig).toEqual(expect.objectContaining({
        relayUrl: 'http://127.0.0.1:8787',
        enrollmentId: token.enrollmentId,
        lastSessionRoomId: token.roomId,
        enrollmentSecretHash: expect.stringMatching(/^sha256:/),
      }))
      expect(db().select().from(agentCredentials).all()).toEqual([
        expect.objectContaining({
          id: 'system:remote-relay-hmac:v1',
          kind: 'system-relay-hmac-secret',
          label: 'Remote relay HMAC signing key',
          encryptedSecret: expect.any(String),
        }),
      ])

      const listSecretsRes = await app.handle(new Request('http://localhost/secrets'))
      expect(listSecretsRes.status).toBe(200)
      expect(await listSecretsRes.json()).toEqual([])
    }
    finally {
      rmSync(dataDir, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
      restoreEnv('CRADLE_CREDENTIAL_SECRET', previousCredentialSecret)
      restoreEnv('CRADLE_RELAY_HMAC_SECRET', previousRelaySecret)
      restoreEnv('CRADLE_RELAYD_DEV_HMAC_SECRET', previousRelayDevSecret)
    }
  })

  it('uses the dev relay HMAC secret when the local secret store is unconfigured', () => {
    const previousNodeEnv = process.env.NODE_ENV
    const previousCradleEnv = process.env.CRADLE_ENV
    const previousCredentialSecret = process.env.CRADLE_CREDENTIAL_SECRET
    const previousRelaySecret = process.env.CRADLE_RELAY_HMAC_SECRET
    const previousRelayDevSecret = process.env.CRADLE_RELAYD_DEV_HMAC_SECRET

    try {
      process.env.NODE_ENV = 'development'
      delete process.env.CRADLE_ENV
      delete process.env.CRADLE_CREDENTIAL_SECRET
      delete process.env.CRADLE_RELAY_HMAC_SECRET
      delete process.env.CRADLE_RELAYD_DEV_HMAC_SECRET

      const token = mintRelayToken({
        subject: 'remote-host-local-dev-secret',
        purpose: 'pairing_start',
        ttlMs: 60_000,
      })
      expect(expectRelayTokenSignedByDevSecret(token.token)).toEqual(expect.objectContaining({
        aud: 'cradle-relay',
        iss: 'cradle-server',
        purpose: 'pairing_start',
      }))
    }
    finally {
      restoreEnv('NODE_ENV', previousNodeEnv)
      restoreEnv('CRADLE_ENV', previousCradleEnv)
      restoreEnv('CRADLE_CREDENTIAL_SECRET', previousCredentialSecret)
      restoreEnv('CRADLE_RELAY_HMAC_SECRET', previousRelaySecret)
      restoreEnv('CRADLE_RELAYD_DEV_HMAC_SECRET', previousRelayDevSecret)
    }
  })

  it('requires an explicit relay HMAC secret in production', () => {
    const previousNodeEnv = process.env.NODE_ENV
    const previousCradleEnv = process.env.CRADLE_ENV
    const previousRelaySecret = process.env.CRADLE_RELAY_HMAC_SECRET
    const previousRelayDevSecret = process.env.CRADLE_RELAYD_DEV_HMAC_SECRET

    try {
      process.env.NODE_ENV = 'production'
      delete process.env.CRADLE_ENV
      delete process.env.CRADLE_RELAY_HMAC_SECRET
      delete process.env.CRADLE_RELAYD_DEV_HMAC_SECRET

      expect(() => mintRelayToken({
        subject: 'remote-host-production-secret',
        purpose: 'pairing_start',
        ttlMs: 60_000,
      })).toThrow('Relay HMAC secret is required in production.')
    }
    finally {
      restoreEnv('NODE_ENV', previousNodeEnv)
      restoreEnv('CRADLE_ENV', previousCradleEnv)
      restoreEnv('CRADLE_RELAY_HMAC_SECRET', previousRelaySecret)
      restoreEnv('CRADLE_RELAYD_DEV_HMAC_SECRET', previousRelayDevSecret)
    }
  })

  it('claims relay pairing and stores relay transport config without writing provider targets', async () => {
    const dataDir = makeTempDir('cradle-remote-hosts-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousCredentialSecret = process.env.CRADLE_CREDENTIAL_SECRET
    const previousRelaySecret = process.env.CRADLE_RELAY_HMAC_SECRET
    const previousRelayDevSecret = process.env.CRADLE_RELAYD_DEV_HMAC_SECRET
    fakeRelay = await startFakeRelay('room_claimed')
    let app: ElysiaApp | undefined

    try {
      process.env.CRADLE_CREDENTIAL_SECRET = 'remote-relay-credential-secret'
      delete process.env.CRADLE_RELAY_HMAC_SECRET
      delete process.env.CRADLE_RELAYD_DEV_HMAC_SECRET
      app = await createAppWithDataDir(dataDir)
      await createRemoteHost(app, {
        hostId: 'remote-host-relay-claim',
        socketPath: '/tmp/cradle-agentd-relay-claim.sock',
      })
      const tokenRes = await app.handle(new Request('http://localhost/remote-hosts/remote-host-relay-claim/relay/pairing-token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          relayUrl: fakeRelay.url,
          ttlMs: 60_000,
        }),
      }))
      expect(tokenRes.status).toBe(200)
      const token = await tokenRes.json() as { enrollmentId: string }
      const hostConfig = JSON.parse(db()
        .select()
        .from(remoteHosts)
        .where(eq(remoteHosts.id, 'remote-host-relay-claim'))
        .get()?.connectionConfigJson ?? '{}')
      db()
        .update(remoteHosts)
        .set({
          connectionConfigJson: JSON.stringify({
            ...hostConfig,
            relay: {
              ...hostConfig.relay,
              lastSessionRoomId: 'room_claimed',
            },
          }),
        })
        .where(eq(remoteHosts.id, 'remote-host-relay-claim'))
        .run()

      const claimRes = await app.handle(new Request('http://localhost/remote-hosts/remote-host-relay-claim/relay/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          relayUrl: fakeRelay.url,
          pairingCode: 'ABCD-1234',
          ttlMs: 60_000,
        }),
      }))
      expect(claimRes.status).toBe(200)
      expect(await claimRes.json()).toEqual(expect.objectContaining({
        relayUrl: fakeRelay.url,
        roomId: 'room_claimed',
        enrollmentId: token.enrollmentId,
      }))

      const hosts = await (await app.handle(new Request('http://localhost/remote-hosts'))).json() as Array<{
        id: string
        connectionConfigJson: string
      }>
      const host = hosts.find(host => host.id === 'remote-host-relay-claim')
      expect(host).toBeDefined()
      expect(JSON.parse(host?.connectionConfigJson ?? '{}')).toEqual(expect.objectContaining({
        transport: 'relay',
        relay: expect.objectContaining({
          relayUrl: fakeRelay.url,
          enrollmentId: token.enrollmentId,
        }),
      }))
      expect(JSON.parse(host?.connectionConfigJson ?? '{}').relay).not.toHaveProperty('controllerToken')
      expect(db().select().from(providerTargets).all()).toHaveLength(0)
      expect(db().select().from(agentCredentials).where(eq(agentCredentials.id, 'system:remote-relay-hmac:v1')).all()).toHaveLength(1)
    }
    finally {
      rmSync(dataDir, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
      restoreEnv('CRADLE_CREDENTIAL_SECRET', previousCredentialSecret)
      restoreEnv('CRADLE_RELAY_HMAC_SECRET', previousRelaySecret)
      restoreEnv('CRADLE_RELAYD_DEV_HMAC_SECRET', previousRelayDevSecret)
    }
  })

  it('creates short-lived relay host sessions from a persisted enrollment secret', async () => {
    const dataDir = makeTempDir('cradle-remote-hosts-session-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousCredentialSecret = process.env.CRADLE_CREDENTIAL_SECRET
    const previousRelaySecret = process.env.CRADLE_RELAY_HMAC_SECRET
    const previousRelayDevSecret = process.env.CRADLE_RELAYD_DEV_HMAC_SECRET
    let app: ElysiaApp | undefined

    try {
      process.env.CRADLE_CREDENTIAL_SECRET = 'remote-relay-credential-secret'
      delete process.env.CRADLE_RELAY_HMAC_SECRET
      delete process.env.CRADLE_RELAYD_DEV_HMAC_SECRET
      app = await createAppWithDataDir(dataDir)
      await createRemoteHost(app, {
        hostId: 'remote-host-relay-session',
        socketPath: '/tmp/cradle-agentd-relay-session.sock',
      })

      const tokenRes = await app.handle(new Request('http://localhost/remote-hosts/remote-host-relay-session/relay/pairing-token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          relayUrl: 'http://127.0.0.1:8787',
          ttlMs: 60_000,
        }),
      }))
      expect(tokenRes.status).toBe(200)
      const token = await tokenRes.json() as {
        enrollmentId: string
        enrollmentSecret: string
      }

      const wrongSecretRes = await app.handle(new Request(`http://localhost/remote-hosts/relay/enrollments/${token.enrollmentId}/host-session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          enrollmentSecret: 'wrong-secret',
          ttlMs: 60_000,
        }),
      }))
      expect(wrongSecretRes.status).toBe(401)

      const sessionRes = await app.handle(new Request(`http://localhost/remote-hosts/relay/enrollments/${token.enrollmentId}/host-session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          enrollmentSecret: token.enrollmentSecret,
          ttlMs: 60_000,
        }),
      }))
      expect(sessionRes.status).toBe(200)
      const session = await sessionRes.json() as {
        relayUrl: string
        roomId: string
        roomStartToken: string
        hostToken: string
      }
      expect(session).toEqual(expect.objectContaining({
        relayUrl: 'http://127.0.0.1:8787',
        roomId: expect.stringMatching(/^room_/),
        roomStartToken: expect.any(String),
        hostToken: expect.any(String),
      }))
      expect(expectRelayTokenSignedByDevSecret(session.roomStartToken)).toEqual(expect.objectContaining({
        purpose: 'room_start',
        roomId: session.roomId,
      }))
      expect(expectRelayTokenSignedByDevSecret(session.hostToken)).toEqual(expect.objectContaining({
        purpose: 'ws',
        role: 'host',
        roomId: session.roomId,
      }))
      const updatedRelayConfig = JSON.parse(db()
        .select()
        .from(remoteHosts)
        .where(eq(remoteHosts.id, token.enrollmentId))
        .get()?.connectionConfigJson ?? '{}').relay
      expect(updatedRelayConfig).toEqual(expect.objectContaining({
        lastSessionRoomId: session.roomId,
        lastSeenAt: expect.any(Number),
      }))
      expect(db().select().from(providerTargets).all()).toHaveLength(0)
    }
    finally {
      rmSync(dataDir, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
      restoreEnv('CRADLE_CREDENTIAL_SECRET', previousCredentialSecret)
      restoreEnv('CRADLE_RELAY_HMAC_SECRET', previousRelaySecret)
      restoreEnv('CRADLE_RELAYD_DEV_HMAC_SECRET', previousRelayDevSecret)
    }
  })

  it('connects to a daemon over a local Unix socket and lists remote state', async () => {
    const dataDir = makeTempDir('cradle-remote-hosts-')
    const daemonHome = makeTempDir('cradle-fake-agentd-home-')
    const socketPath = join(makeTempDir('cradle-fake-agentd-sock-'), 'agent.sock')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    fakeDaemon = await startFakeDaemon(socketPath)
    let app: ElysiaApp | undefined

    try {
      app = await createAppWithDataDir(dataDir)
      await createRemoteHost(app, {
        hostId: 'remote-host-live',
        socketPath,
      })

      const connectRes = await app.handle(new Request('http://localhost/remote-hosts/remote-host-live/agentd/connect', {
        method: 'POST',
      }))
      expect(connectRes.status).toBe(200)
      expect(await connectRes.json()).toEqual(expect.objectContaining({
        hostId: 'remote-host-live',
        state: 'connected',
        daemonHostId: 'fake-daemon-host',
      }))

      const runtimesRes = await app.handle(new Request('http://localhost/remote-hosts/remote-host-live/agentd/runtimes'))
      expect(runtimesRes.status).toBe(200)
      expect(await runtimesRes.json()).toEqual({
        runtimes: [
          {
            runtimeKind: 'mock-remote',
            label: 'Remote Mock',
            status: 'available',
            detail: null,
          },
        ],
      })

      const directoryRes = await app.handle(new Request(`http://localhost/remote-hosts/remote-host-live/agentd/fs/directory?path=${encodeURIComponent(daemonHome)}`))
      expect(directoryRes.status).toBe(200)
      expect(await directoryRes.json()).toEqual(expect.objectContaining({
        path: daemonHome,
        entries: [expect.objectContaining({ name: 'repo', kind: 'directory' })],
      }))

      const statRes = await app.handle(new Request(`http://localhost/remote-hosts/remote-host-live/agentd/fs/stat?path=${encodeURIComponent(join(daemonHome, 'repo'))}`))
      expect(statRes.status).toBe(200)
      expect(await statRes.json()).toEqual(expect.objectContaining({
        path: join(daemonHome, 'repo'),
        name: 'repo',
        kind: 'directory',
      }))

      const gitRes = await app.handle(new Request(`http://localhost/remote-hosts/remote-host-live/agentd/git/repository?path=${encodeURIComponent(join(daemonHome, 'repo', 'src'))}`))
      expect(gitRes.status).toBe(200)
      expect(await gitRes.json()).toEqual(expect.objectContaining({
        path: join(daemonHome, 'repo', 'src'),
        isRepository: true,
        rootPath: join(daemonHome, 'repo'),
      }))

      const agentRes = await app.handle(new Request('http://localhost/remote-hosts/remote-host-live/agentd/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          runtimeKind: 'mock-remote',
          workspacePath: daemonHome,
        }),
      }))
      expect(agentRes.status).toBe(200)
      const started = await agentRes.json() as { agent: RemoteAgentSummary }
      expect(started.agent.runtimeKind).toBe('mock-remote')

      const agentsRes = await app.handle(new Request('http://localhost/remote-hosts/remote-host-live/agentd/agents'))
      expect(agentsRes.status).toBe(200)
      expect(await agentsRes.json()).toEqual({
        agents: [expect.objectContaining({ agentId: started.agent.agentId })],
      })
    }
    finally {
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(daemonHome, { recursive: true, force: true })
      rmSync(dirname(socketPath), { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
    }
  })

  it('streams remote-mock output through normal chat runtime projection', async () => {
    const dataDir = makeTempDir('cradle-remote-chat-')
    const workspaceRoot = makeTempDir('cradle-remote-chat-workspace-')
    const socketPath = join(makeTempDir('cradle-fake-agentd-sock-'), 'agent.sock')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    fakeDaemon = await startFakeDaemon(socketPath)
    let app: ElysiaApp | undefined

    try {
      app = await createAppWithDataDir(dataDir)
      await createRemoteHost(app, {
        hostId: 'remote-host-chat',
        socketPath,
      })

      db().insert(workspaces).values({
        id: 'workspace-remote-chat',
        name: 'Remote Chat Workspace',
        locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot }),
        gitIdentityJson: '{}',
      }).run()
      db().insert(providerTargets).values({
        id: 'provider-target-remote-chat',
        kind: 'manual',
        providerKind: 'universal',
        displayName: 'Remote Chat Target',
        connectionConfigJson: JSON.stringify({
          remoteHostId: 'remote-host-chat',
        }),
      }).run()

      const sessionRes = await app.handle(new Request('http://localhost/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'session-remote-chat',
          workspaceId: 'workspace-remote-chat',
          title: 'Remote Chat',
          providerTargetId: 'provider-target-remote-chat',
          runtimeKind: 'remote-mock',
        }),
      }))
      expect(sessionRes.status).toBe(200)

      const response = await app.handle(new Request('http://localhost/chat/sessions/session-remote-chat/response', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Ping remote daemon' }),
      }))
      expect(response.status).toBe(200)
      await response.text()

      const assistant = await waitForAssistantMessage('session-remote-chat')
      expect(assistant.content).toContain('Remote mock response: Ping remote daemon')
      const link = db()
        .select()
        .from(remoteHostAgentdSessionLinks)
        .where(eq(remoteHostAgentdSessionLinks.chatSessionId, 'session-remote-chat'))
        .get()
      expect(link).toEqual(expect.objectContaining({
        remoteHostId: 'remote-host-chat',
        remoteRuntimeKind: 'mock-remote',
      }))
    }
    finally {
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      rmSync(dirname(socketPath), { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
    }
  })

  it('streams remote-mock output through relay transport projection', async () => {
    const dataDir = makeTempDir('cradle-remote-relay-chat-')
    const workspaceRoot = makeTempDir('cradle-remote-relay-chat-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    fakeRelay = await startFakeRelay('room_remote_relay_chat')
    let app: ElysiaApp | undefined

    try {
      app = await createAppWithDataDir(dataDir)
      await createRelayRemoteHost(app, {
        hostId: 'remote-host-relay-chat',
        relayUrl: fakeRelay.url,
        roomId: 'room_remote_relay_chat',
      })

      db().insert(workspaces).values({
        id: 'workspace-remote-relay-chat',
        name: 'Remote Relay Chat Workspace',
        locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot }),
        gitIdentityJson: '{}',
      }).run()
      db().insert(providerTargets).values({
        id: 'provider-target-remote-relay-chat',
        kind: 'manual',
        providerKind: 'universal',
        displayName: 'Remote Relay Chat Target',
        connectionConfigJson: JSON.stringify({
          remoteHostId: 'remote-host-relay-chat',
        }),
      }).run()

      const sessionRes = await app.handle(new Request('http://localhost/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'session-remote-relay-chat',
          workspaceId: 'workspace-remote-relay-chat',
          title: 'Remote Relay Chat',
          providerTargetId: 'provider-target-remote-relay-chat',
          runtimeKind: 'remote-mock',
        }),
      }))
      expect(sessionRes.status).toBe(200)

      const response = await app.handle(new Request('http://localhost/chat/sessions/session-remote-relay-chat/response', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Ping relay daemon' }),
      }))
      expect(response.status).toBe(200)
      await response.text()

      const assistant = await waitForAssistantMessage('session-remote-relay-chat')
      expect(assistant.content).toContain('Remote mock response: Ping relay daemon')
      const link = db()
        .select()
        .from(remoteHostAgentdSessionLinks)
        .where(eq(remoteHostAgentdSessionLinks.chatSessionId, 'session-remote-relay-chat'))
        .get()
      expect(link).toEqual(expect.objectContaining({
        remoteHostId: 'remote-host-relay-chat',
        remoteRuntimeKind: 'mock-remote',
      }))
    }
    finally {
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
    }
  })
})

async function createRemoteHost(
  app: ElysiaApp,
  input: { hostId: string, socketPath: string },
): Promise<void> {
  const res = await app.handle(new Request('http://localhost/remote-hosts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: input.hostId,
      displayName: input.hostId,
      connectionConfig: {
        transport: 'direct-socket',
        localSocketPath: input.socketPath,
        connectTimeoutMs: 3_000,
      },
      capabilities: {
        agentd: { remoteSocketPath: '/unused/agent.sock' },
      },
    }),
  }))
  expect(res.status).toBe(200)
}

async function createRelayRemoteHost(
  app: ElysiaApp,
  input: { hostId: string, relayUrl: string, roomId: string },
): Promise<void> {
  const res = await app.handle(new Request('http://localhost/remote-hosts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: input.hostId,
      displayName: input.hostId,
      connectionConfig: {
        transport: 'relay',
        connectTimeoutMs: 3_000,
        relay: {
          relayUrl: input.relayUrl,
          enrollmentId: input.hostId,
          enrollmentSecretHash: 'sha256:test',
          lastSessionRoomId: input.roomId,
        },
      },
      capabilities: {
        agentd: { remoteSocketPath: '/unused/agent.sock' },
      },
    }),
  }))
  expect(res.status).toBe(200)
}

async function waitForAssistantMessage(sessionId: string): Promise<typeof messages.$inferSelect> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const row = db()
      .select()
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .all()
      .find(message => message.role === 'assistant')
    if (row?.status === 'complete') {
      return row
    }
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`Timed out waiting for assistant message in ${sessionId}`)
}

async function startFakeDaemon(socketPath: string): Promise<FakeDaemonServer> {
  mkdirSync(dirname(socketPath), { recursive: true })
  const httpServer = createServer()
  const socketServer = new WebSocketServer({ server: httpServer })
  const sockets = new Set<WebSocket>()
  const agents = new Map<string, RemoteAgentSummary>()

  socketServer.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('message', (raw) => {
      void handleFakeDaemonFrame(socket, agents, raw.toString())
    })
  })

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(socketPath, () => {
      httpServer.off('error', reject)
      resolve()
    })
  })

  return {
    socketPath,
    close: async () => {
      for (const socket of sockets) {
        socket.close()
      }
      await new Promise<void>((resolve, reject) => {
        socketServer.close()
        httpServer.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
    },
  }
}

async function startFakeRelay(roomId: string): Promise<FakeRelayServer> {
  const sockets = new Set<WebSocket>()
  const agents = new Map<string, RemoteAgentSummary>()
  const httpServer = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/pairing/claim') {
      response.writeHead(404)
      response.end()
      return
    }
    const chunks: Buffer[] = []
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    const body = JSON.parse(Buffer.concat(chunks).toString()) as {
      pairingCode?: string
      controllerToken?: string
    }
    if (body.pairingCode !== 'ABCD-1234') {
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'invalid pairing code' }))
      return
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ roomId }))
  })
  const socketServer = new WebSocketServer({ server: httpServer })

  socketServer.on('connection', (socket) => {
    let seq = 1
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('message', (raw) => {
      void handleFakeRelayEnvelope(socket, agents, raw.toString(), () => seq++)
    })
  })

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(0, '127.0.0.1', () => {
      httpServer.off('error', reject)
      resolve()
    })
  })
  const address = httpServer.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      for (const socket of sockets) {
        socket.close()
      }
      await new Promise<void>((resolve, reject) => {
        socketServer.close(() => {
          httpServer.close((error) => {
            if (error) {
              reject(error)
              return
            }
            resolve()
          })
        })
      })
    },
  }
}

async function handleFakeDaemonFrame(
  socket: WebSocket,
  agents: Map<string, RemoteAgentSummary>,
  raw: string,
): Promise<void> {
  const frame = parseRemoteAgentFrame(raw)
  await handleFakeRemoteAgentFrame(frame, agents, (response) => {
    sendFrame(socket, response)
  })
}

async function handleFakeRelayEnvelope(
  socket: WebSocket,
  agents: Map<string, RemoteAgentSummary>,
  raw: string,
  nextSeq: () => number,
): Promise<void> {
  const envelope = parseRelayEnvelope(raw)
  if (envelope.kind !== 'remote_agent_frame') {
    return
  }
  const frame = parseRemoteAgentFrame(envelope.payload)
  await handleFakeRemoteAgentFrame(frame, agents, (response) => {
    sendRelayFrame(socket, envelope.roomId, nextSeq(), response)
  })
}

async function handleFakeRemoteAgentFrame(
  frame: RemoteAgentFrame,
  agents: Map<string, RemoteAgentSummary>,
  send: (frame: RemoteAgentFrame) => void,
): Promise<void> {
  if (frame.kind === 'rpc.request') {
    send({
      protocolVersion: REMOTE_AGENT_PROTOCOL_VERSION,
      kind: 'rpc.response',
      id: frame.id,
      result: handleFakeUnary(frame.method, frame.params, agents),
    })
    return
  }
  if (frame.kind === 'stream.open' && frame.method === 'agent/turn') {
    const params = frame.params as RemoteAgentTurnParams
    const textId = `fake-text-${params.runId}`
    const text = `Remote mock response: ${readMessageText(params.message) || '(empty)'}`
    send({
      protocolVersion: REMOTE_AGENT_PROTOCOL_VERSION,
      kind: 'stream.next',
      streamId: frame.streamId,
      value: { kind: 'chunk', chunk: { type: 'text-start', id: textId } },
    })
    send({
      protocolVersion: REMOTE_AGENT_PROTOCOL_VERSION,
      kind: 'stream.next',
      streamId: frame.streamId,
      value: { kind: 'chunk', chunk: { type: 'text-delta', id: textId, delta: text } },
    })
    send({
      protocolVersion: REMOTE_AGENT_PROTOCOL_VERSION,
      kind: 'stream.next',
      streamId: frame.streamId,
      value: { kind: 'chunk', chunk: { type: 'text-end', id: textId } },
    })
    send({
      protocolVersion: REMOTE_AGENT_PROTOCOL_VERSION,
      kind: 'stream.next',
      streamId: frame.streamId,
      value: { kind: 'chunk', chunk: { type: 'finish', finishReason: 'stop' } },
    })
    send({
      protocolVersion: REMOTE_AGENT_PROTOCOL_VERSION,
      kind: 'stream.close',
      streamId: frame.streamId,
    })
  }
}

function handleFakeUnary(
  method: string,
  params: unknown,
  agents: Map<string, RemoteAgentSummary>,
): unknown {
  switch (method) {
    case 'host/hello':
      return {
        protocolVersion: REMOTE_AGENT_PROTOCOL_VERSION,
        daemonVersion: 'fake-0.1.0',
        hostId: 'fake-daemon-host',
        platform: process.platform,
        arch: process.arch,
        supportedMethods: [
          'host/hello',
          'host/health',
          'runtime/list',
          'workspace/list',
          'fs/listDirectory',
          'fs/stat',
          'git/probeRepository',
          'agent/list',
          'agent/start',
          'agent/attach',
          'agent/cancel',
          'agent/steer',
          'agent/turn',
        ],
      }
    case 'host/health':
      return {
        status: 'ok',
        daemonVersion: 'fake-0.1.0',
        hostId: 'fake-daemon-host',
        uptimeSeconds: 1,
      }
    case 'runtime/list':
      return {
        runtimes: [
          {
            runtimeKind: 'mock-remote',
            label: 'Remote Mock',
            status: 'available',
            detail: null,
          },
        ],
      }
    case 'workspace/list':
      return { workspaces: [], message: null }
    case 'fs/listDirectory': {
      const path = (params as { path?: string | null }).path ?? process.cwd()
      return {
        path,
        parentPath: dirname(path),
        entries: [
          {
            name: 'repo',
            path: join(path, 'repo'),
            kind: 'directory',
            size: null,
            modifiedAt: 1,
            hidden: false,
          },
        ],
      }
    }
    case 'fs/stat': {
      const path = (params as { path: string }).path
      return {
        path,
        name: path.split('/').filter(Boolean).at(-1) ?? path,
        kind: 'directory',
        size: null,
        modifiedAt: 1,
        hidden: false,
      }
    }
    case 'git/probeRepository': {
      const path = (params as { path: string }).path
      return {
        path,
        isRepository: true,
        rootPath: path.replace(/\/src$/, ''),
        branch: 'main',
        remoteUrl: null,
      }
    }
    case 'agent/list':
      return { agents: Array.from(agents.values()) }
    case 'agent/start': {
      const input = params as AgentStartParams
      const now = Date.now()
      const agent: RemoteAgentSummary = {
        agentId: randomUUID(),
        runtimeKind: input.runtimeKind,
        workspacePath: input.workspacePath,
        status: 'idle',
        providerSessionId: null,
        createdAt: now,
        updatedAt: now,
      }
      agents.set(agent.agentId, agent)
      return { agent }
    }
    case 'agent/attach': {
      const remoteAgentId = (params as { remoteAgentId: string }).remoteAgentId
      const agent = agents.get(remoteAgentId)
      if (!agent) {
        throw new Error(`missing fake agent ${remoteAgentId}`)
      }
      return { agent }
    }
    case 'agent/cancel':
      return { cancelled: true }
    case 'agent/steer':
      return { accepted: true }
    default:
      throw new Error(`unsupported fake method ${method}`)
  }
}

function sendFrame(socket: WebSocket, frame: RemoteAgentFrame): void {
  socket.send(encodeRemoteAgentFrame(frame))
}

function sendRelayFrame(socket: WebSocket, roomId: string, seq: number, frame: RemoteAgentFrame): void {
  const envelope: RelayEnvelope = {
    version: 1,
    roomId,
    seq,
    kind: 'remote_agent_frame',
    payload: JSON.parse(encodeRemoteAgentFrame(frame)),
  }
  socket.send(encodeRelayEnvelope(envelope))
}

function readMessageText(message: UIMessage): string {
  return message.parts
    .map((part) => {
      if (typeof part === 'object' && part !== null && 'text' in part && typeof part.text === 'string') {
        return part.text
      }
      return ''
    })
    .join('')
    .trim()
}
