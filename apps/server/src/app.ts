import { cors } from '@elysiajs/cors'
import { node } from '@elysiajs/node'
import { Elysia } from 'elysia'

import { loadServerAuthConfig } from './config/server-config'
import { createAuthPlugin } from './http/auth'
import { createOpenApiPlugin, registerOpenApiAlias } from './http/openapi'
import { createRequestIdPlugin } from './http/request-id'
import { acp } from './modules/acp'
import { agentIdentity } from './modules/agent-identity'
import { agentInteractionRuntime } from './modules/agent-interaction-runtime'
import { registerAgentToolsMcpServer } from './modules/agent-tools/runtime-registration'
import { assets } from './modules/assets'
import { automation } from './modules/automation'
import { backgroundJob } from './modules/background-job'
import * as BackgroundJobPoller from './modules/background-job/poller'
import { chatRuntime } from './modules/chat-runtime'
import {
  chatRuntimeEventRoutes,
  chatRuntimeGlobalEventRoutes,
} from './modules/chat-runtime/http/events.routes'
import { linkedChatSessionProxyPlugin } from './modules/chat-runtime/http/linked-session-proxy'
import { registerTurnCheckpointHooks } from './modules/chat-runtime/turn-checkpoint-hooks'
import { createChronicleModule } from './modules/chronicle'
import { conversationBridge } from './modules/conversation-bridge'
import { desktop } from './modules/desktop'
import { diffReview } from './modules/diff-review'
import { createDownloadCenterModule } from './modules/download-center'
import { DownloadCenterService } from './modules/download-center/service'
import { externalIssueSources } from './modules/external-issue-sources'
import { externalProviderSources } from './modules/external-provider-sources'
import { externalWorkImport } from './modules/external-work-import'
import { filesystem } from './modules/filesystem'
import { git } from './modules/git'
import { health } from './modules/health'
import { imageOcr } from './modules/image-ocr'
import { issue } from './modules/issue'
import { issueAgent } from './modules/issue-agent'
import { kanban } from './modules/kanban'
import { linkPreview } from './modules/link-preview'
import { modelRegistry } from './modules/model-registry'
import { observability } from './modules/observability'
import { opencodeServer } from './modules/opencode-server'
import { createPluginsModule } from './modules/plugins'
import { preferences } from './modules/preferences'
import { profiles } from './modules/profiles'
import { providers } from './modules/provider-catalog'
import { providerTargets } from './modules/provider-targets'
import { registerPtyRoutes } from './modules/pty'
import { pullRequest, pullRequestFeed } from './modules/pull-request'
import { relayServers } from './modules/relay-servers'
import { relayTransport } from './modules/relay-transport'
import { listActiveRelayAuthTokens } from './modules/relay-transport/relay-auth-token-service'
import { remoteHosts } from './modules/remote-hosts'
import { search } from './modules/search'
import { secrets } from './modules/secrets'
import { session } from './modules/session'
import { sessionAwait } from './modules/session-await'
import { sessionEnvironment } from './modules/session-environment'
import { sessionGroup } from './modules/session-group'
import { skills } from './modules/skills'
import { registerSyncGatewayRoutes } from './modules/sync-gateway'
import { testReset } from './modules/test-reset'
import { threadHandoff } from './modules/thread-handoff'
import { turnCheckpoint } from './modules/turn-checkpoint'
import * as TurnCheckpoint from './modules/turn-checkpoint/service'
import { usage } from './modules/usage'
import { sessionWork, work } from './modules/work'
import { workflowRules } from './modules/workflow-rules'
import { workspace } from './modules/workspace'
import { worktree } from './modules/worktree'
import { RuntimeResourceRegistry } from './runtime-resource-registry'

interface CreateServerAppOptions {
  startBackgroundTasks?: boolean
  recoverPersistedRunsOnCreate?: boolean
}

interface CreateServerContractAppOptions {
  includeRuntimeHttpPlugins?: boolean
  downloadCenterService?: DownloadCenterService
}

const HOSTED_WEB_APP_ORIGINS = new Set([
  'http://app.cradle.wibus.ren',
  'https://app.cradle.wibus.ren',
])

function isAllowedCorsOriginValue(origin: string | null): boolean {
  if (!origin || origin === 'null') {
    return true
  }

  try {
    if (HOSTED_WEB_APP_ORIGINS.has(origin)) {
      return true
    }

    const parsed = new URL(origin)
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)
    )
  }
 catch {
    return false
  }
}

function isAllowedCorsOrigin({ headers }: { headers: Headers }): boolean {
  return isAllowedCorsOriginValue(headers.get('origin'))
}

export async function createServerContractApp(options: CreateServerContractAppOptions = {}) {
  registerTurnCheckpointHooks({
    captureStart: async (input) => {
      await TurnCheckpoint.captureRunStart(input)
    },
    captureEnd: async (input) => {
      await TurnCheckpoint.captureRunEnd(input)
    },
  })
  const { includeRuntimeHttpPlugins = false } = options
  const downloadCenter = createDownloadCenterModule(options.downloadCenterService)
  const chronicle = createChronicleModule(downloadCenter.service)
  const app = new Elysia({
    name: 'cradle.server.elysia',
    adapter: node(),
    normalize: 'typebox',
  })

  app.onRequest(({ request, set }) => {
    if (
      request.headers.get('access-control-request-private-network') === 'true'
      && isAllowedCorsOriginValue(request.headers.get('origin'))
    ) {
      set.headers['access-control-allow-private-network'] = 'true'
    }
  })
  app.use(
    cors({
      credentials: true,
      origin: isAllowedCorsOrigin,
      exposeHeaders: [
        'x-cradle-run-id',
        'x-cradle-assistant-message-id',
        'x-cradle-user-message-id',
      ],
    }),
  )
  app.use(createRequestIdPlugin())
  app.use(
    createAuthPlugin({
      ...loadServerAuthConfig(),
      listRelayAuthTokens: listActiveRelayAuthTokens,
    }),
  )
  if (includeRuntimeHttpPlugins) {
    const [{ createRequestLoggerPlugin }, { createErrorHandler }] = await Promise.all([
      import('./http/request-logger'),
      import('./http/error-mapping'),
    ])
    app.use(createRequestLoggerPlugin())
    app.onError(createErrorHandler())
  }
  app.use(createOpenApiPlugin())
  app.use(health)
  app.use(preferences)
  app.use(workspace)
  app.use(filesystem)
  app.use(usage)
  app.use(profiles)
  app.use(providerTargets)
  app.use(relayServers)
  app.use(relayTransport)
  app.use(remoteHosts)
  app.use(externalIssueSources)
  app.use(externalProviderSources)
  app.use(externalWorkImport)
  app.use(secrets)
  app.use(modelRegistry)
  app.use(providers)
  app.use(agentIdentity)
  app.use(automation)
  app.use(assets)
  app.use(backgroundJob)
  app.use(session)
  app.use(sessionEnvironment)
  app.use(threadHandoff)
  app.use(turnCheckpoint)
  app.use(work)
  app.use(sessionWork)
  app.use(pullRequest)
  app.use(pullRequestFeed)
  app.use(sessionGroup)
  app.use(sessionAwait)
  app.use(issue)
  app.use(imageOcr)
  app.use(kanban)
  app.use(linkPreview)
  app.use(search)
  app.use(createPluginsModule({ downloadCenter: downloadCenter.service }))
  app.use(skills)
  app.use(workflowRules)
  app.use(git)
  app.use(worktree)
  app.use(diffReview)
  app.use(acp)
  // Projected remote sessions: transparent upstream for all /chat/sessions/:id/* paths
  // (including event routes mounted separately below).
  app.use(linkedChatSessionProxyPlugin)
  app.use(chatRuntimeGlobalEventRoutes)
  app.use(chatRuntimeEventRoutes)
  app.use(chatRuntime)
  app.use(conversationBridge)
  app.use(chronicle)
  app.use(opencodeServer)
  app.use(agentInteractionRuntime)
  app.use(desktop)
  app.use(downloadCenter.routes)
  registerPtyRoutes(app)
  registerSyncGatewayRoutes(app)
  app.use(observability)
  app.use(issueAgent)
  if (process.env.NODE_ENV === 'test') {
    app.use(testReset)
  }

  registerOpenApiAlias(app)

  return app
}

export async function createServerApp(options: CreateServerAppOptions = {}) {
  const {
    recoverPersistedRunsOnCreate = false,
    startBackgroundTasks = process.env.NODE_ENV !== 'test',
  } = options
  const downloadCenterService = new DownloadCenterService()
  await downloadCenterService.boot()
  const [
    { shutdownInfra, getServerConfig },
    { abortAllRuns, flushAllActiveRunSnapshots, recoverPersistedRunProjections },
    { shutdownTraceStreams },
    { cleanup: chronicleCleanup },
    chronicleService,
    { refreshAllExternalProviderSources },
    { reconcileExternalIssueSourceRegistrations },
    { providerRuntimeHostManager },
    { clearSideConversations },
    { activateServerPlugins, deactivateAllPlugins },
    conversationBridgeSupervisor,
    { destroyWorkspaceFileIndexes },
    localRelaydSupervisor,
    { stopOpencodeServer },
    { initHostConnectorService, getHostConnectorService },
    { shutdownRemoteHostConnections },
    { shutdownImageOcr },
  ] = await Promise.all([
    import('./infra'),
    import('./modules/chat-runtime/runtime'),
    import('./modules/chat-runtime/stream-trace'),
    import('./modules/chronicle/daemon-manager'),
    import('./modules/chronicle/service'),
    import('./modules/external-provider-sources/service'),
    import('./modules/external-issue-sources/service'),
    import('./modules/provider-runtime/host-manager'),
    import('./modules/provider-runtime/side-conversation-registry'),
    import('./plugins/loader'),
    import('./modules/conversation-bridge/runtime-supervisor'),
    import('./modules/workspace/files'),
    import('./modules/relay-servers/local-relayd-supervisor'),
    import('./modules/chat-runtime-providers/opencode/runtime-context'),
    import('./modules/relay-transport/host-connector'),
    import('./modules/remote-hosts/service'),
    import('./modules/image-ocr/service'),
  ])
  if (recoverPersistedRunsOnCreate) {
    recoverPersistedRunProjections()
  }

  const app = await createServerContractApp({ includeRuntimeHttpPlugins: true, downloadCenterService })
  registerAgentToolsMcpServer()

  // Initialize the always-on relay host-connector (connects to the host's own
  // HTTP port to bridge controller tunnels). The local target is this server's
  // own listen port — stream_open from a controller lands here.
  const serverConfig = getServerConfig()
  const hostConnector = initHostConnectorService({
    localServerHost: '127.0.0.1',
    localServerPort: serverConfig.port,
  })

  // Plugin system — discover and activate server plugins
  await activateServerPlugins(app)
  reconcileExternalIssueSourceRegistrations()

  const runtimeResources = new RuntimeResourceRegistry()
  runtimeResources.register({
    name: 'download-center',
    phase: 'cancel',
    stop: () => downloadCenterService.shutdown(),
  })
  runtimeResources.register({
    name: 'active-run-snapshots',
    phase: 'drain',
    stop: flushAllActiveRunSnapshots,
  })
  runtimeResources.register({ name: 'active-chat-runs', phase: 'drain', stop: abortAllRuns })
  runtimeResources.register({
    name: 'side-conversations',
    phase: 'stop',
    stop: clearSideConversations,
  })
  runtimeResources.register({
    name: 'conversation-bridge',
    phase: 'stop',
    stop: () => conversationBridgeSupervisor.stopAllConversationBridgeConnections(),
  })
  runtimeResources.register({ name: 'plugins', phase: 'stop', stop: deactivateAllPlugins })
  runtimeResources.register({
    name: 'provider-runtime',
    phase: 'stop',
    stop: () => providerRuntimeHostManager.shutdown(),
  })
  runtimeResources.register({ name: 'opencode-server', phase: 'stop', stop: stopOpencodeServer })
  runtimeResources.register({
    name: 'local-relayd',
    phase: 'stop',
    stop: () => localRelaydSupervisor.stopManagedLocalRelayd(),
  })
  runtimeResources.register({
    name: 'background-job-poller',
    phase: 'cancel',
    stop: () => BackgroundJobPoller.stop(),
  })
  runtimeResources.register({
    name: 'relay-host-connector',
    phase: 'cancel',
    stop: () => getHostConnectorService()?.stopAll(),
  })
  runtimeResources.register({
    name: 'remote-host-connections',
    phase: 'cancel',
    stop: shutdownRemoteHostConnections,
  })
  runtimeResources.register({
    name: 'chronicle-scheduler',
    phase: 'stop',
    stop: () => chronicleService.stopActivityPipelineScheduler(),
  })
  runtimeResources.register({
    name: 'chronicle-slack-sync',
    phase: 'stop',
    stop: () => chronicleService.stopSlackBackgroundSync(),
  })
  runtimeResources.register({ name: 'chronicle-daemon', phase: 'stop', stop: chronicleCleanup })
  runtimeResources.register({ name: 'trace-streams', phase: 'stop', stop: shutdownTraceStreams })
  runtimeResources.register({
    name: 'workspace-indexes',
    phase: 'stop',
    stop: destroyWorkspaceFileIndexes,
  })
  runtimeResources.register({ name: 'image-ocr', phase: 'stop', stop: shutdownImageOcr })
  runtimeResources.register({ name: 'infrastructure', phase: 'close', stop: shutdownInfra })
  app.onStop(() => runtimeResources.shutdown())

  // Start chronicle daemon if enabled
  if (startBackgroundTasks) {
    BackgroundJobPoller.start()
    const chronicleRuntimeAllowed = chronicleService.isChronicleRuntimeAllowed()
    void refreshAllExternalProviderSources()
      .then((results) => {
        for (const result of results) {
          if (result.status === 'error') {
            console.error('[external-provider-sources] Source refresh failed:', {
              sourceKey: result.sourceKey,
              message: result.message ?? 'Unknown sync error',
            })
          }
        }
      })
      .catch((error) => {
        console.error('[external-provider-sources] Refresh failed:', error)
      })
    if (chronicleRuntimeAllowed) {
      void chronicleService.initDaemon().catch((error) => {
        console.error('[chronicle] Daemon initialization failed:', error)
      })
      chronicleService.startSlackBackgroundSync()
    }
    providerRuntimeHostManager.startReaper()
    void conversationBridgeSupervisor.startEnabledConversationBridgeConnections().catch((error) => {
      console.error('[conversation-bridge] start enabled connections failed:', error)
    })
    void localRelaydSupervisor.startManagedLocalRelayd().catch((error) => {
      console.error('[relay-servers] managed relayd warm-start failed:', error)
    })
    // Start the always-on relay host-connector for any existing enrollments.
    // Each enrollment maintains its own /ws/host connection with backoff.
    try {
      hostConnector.startAll()
    }
 catch (error) {
      console.error('[relay-host-connector] startAll failed:', error)
    }
  }

  return app
}
