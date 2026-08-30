import { dirname } from 'node:path'

import { cors } from '@elysiajs/cors'
import { node } from '@elysiajs/node'
import { Elysia } from 'elysia'

import type { ServerBootstrapReporter } from './bootstrap-lifecycle'
import { loadServerAuthConfig } from './config/server-config'
import { createAuthPlugin } from './http/auth'
import { createOpenApiPlugin, registerOpenApiAlias } from './http/openapi'
import { createRequestIdPlugin } from './http/request-id'
import { compactDatabase, getServerConfig, initializeDatabase, shutdownInfra } from './infra'
import { setGitHubAuthProvider } from './lib/github/auth-provider'
import * as GitHubCache from './lib/github-cache'
import { rotateServerLog } from './logging/logger'
import { createAcpModule } from './modules/acp'
import { agentIdentity } from './modules/agent-identity'
import { agentInteractionRuntime } from './modules/agent-interaction-runtime'
import { registerAgentToolsMcpServer } from './modules/agent-tools/runtime-registration'
import { assets } from './modules/assets'
import { automation } from './modules/automation'
import { backgroundActivity } from './modules/background-activity'
import * as BackgroundActivity from './modules/background-activity/service'
import { backgroundJob } from './modules/background-job'
import * as BackgroundJobPoller from './modules/background-job/poller'
import { blobStore } from './modules/blob-store'
import { registerBlobStoreMaintenance } from './modules/blob-store/gc'
import { chatArtifacts } from './modules/chat-artifacts'
import { chatRuntime } from './modules/chat-runtime'
import { getRuntimeRegistry } from './modules/chat-runtime/chat-runtime-provider-registry'
import * as ComposerDrafts from './modules/chat-runtime/composer-drafts'
import {
  chatRuntimeEventRoutes,
  chatRuntimeGlobalEventRoutes,
} from './modules/chat-runtime/http/events.routes'
import { linkedChatSessionProxyPlugin } from './modules/chat-runtime/http/linked-session-proxy'
import { registerMessageBlobBackfillMaintenance } from './modules/chat-runtime/message-blob-backfill'
import { registerMessageSteerSplitBackfillMaintenance } from './modules/chat-runtime/message-steer-split-backfill'
import { runRegistry } from './modules/chat-runtime/run-registry'
import { flushRunSnapshotWriteBehind } from './modules/chat-runtime/run-snapshot-journal'
import { registerChatRuntimeSessionLifecycleHandlers } from './modules/chat-runtime/runtime'
import { registerTurnCheckpointHooks } from './modules/chat-runtime/turn-checkpoint-hooks'
import { ClaudeUsageReconciliationScheduler } from './modules/chat-runtime-providers/claude-agent/usage-reconciliation-scheduler'
import { readCodexChatgptAuthCredential } from './modules/chat-runtime-providers/codex/app-server/chatgpt-auth'
import { createOpencodeManagedResourceAdapter } from './modules/chat-runtime-providers/opencode/managed-resource-adapter'
import { OpencodeRuntimeInstallationService } from './modules/chat-runtime-providers/opencode/runtime-installation'
import { createChronicleModule } from './modules/chronicle'
import { createChronicleManagedResourceAdapter } from './modules/chronicle/managed-resource-adapter'
import { codeActivity } from './modules/code-activity'
import { codexAppServer } from './modules/codex-app-server'
import { registerCodexResetWatchMaintenance } from './modules/codex-reset-watch/service'
import { conversationBridge } from './modules/conversation-bridge'
import { desktop } from './modules/desktop'
import { diffReview } from './modules/diff-review'
import { createDownloadCenterModule } from './modules/download-center'
import { DownloadCenterService } from './modules/download-center/service'
import { externalIssueSources } from './modules/external-issue-sources'
import { externalProviderSources } from './modules/external-provider-sources'
import { externalSessionImport } from './modules/external-session-import'
import {
  createFabricNodeRoutes,
  fabric,
  registerFabricMembershipChangedListener,
  registerFabricWebSocketRoutes,
} from './modules/fabric'
import { filesystem } from './modules/filesystem'
import { git } from './modules/git'
import { githubAuth } from './modules/github-auth'
import * as GitHubAuth from './modules/github-auth/service'
import { health } from './modules/health'
import * as Health from './modules/health/service'
import { imageOcr } from './modules/image-ocr'
import { issue } from './modules/issue'
import { issueAgent } from './modules/issue-agent'
import { javascriptEval } from './modules/javascript-eval'
import { kanban } from './modules/kanban'
import { kimiServer } from './modules/kimi-server'
import { linkPreview } from './modules/link-preview'
import * as Maintenance from './modules/maintenance/service'
import { createManagedResourcesModule } from './modules/managed-resources'
import { ManagedResourceService } from './modules/managed-resources/service'
import { mcpServers } from './modules/mcp-servers'
import { modelRegistry } from './modules/model-registry'
import { observability } from './modules/observability'
import { opencodeServer } from './modules/opencode-server'
import { createPluginsModule } from './modules/plugins'
import { preferences } from './modules/preferences'
import { profiles } from './modules/profiles'
import { providerPresets, providers } from './modules/provider-catalog'
import { providerExtensions } from './modules/provider-extensions'
import { configureProviderExtensionHost } from './modules/provider-extensions/host'
import { releaseLiveProviderRuntimeSessionsForProviderTarget } from './modules/provider-runtime/service'
import { providerTargets } from './modules/provider-targets'
import { registerPtyRoutes } from './modules/pty'
import { pullRequest, pullRequestFeed } from './modules/pull-request'
import { recall } from './modules/recall'
import { assertRelayCompressionRuntimeSupport } from './modules/relay-transport/compression'
import { FabricNodeConnector, listActiveFabricNodeAuthTokens } from './modules/relay-transport/node-connector'
import { getFabricNodeLinkManager } from './modules/relay-transport/node-link-manager'
import { search } from './modules/search'
import { secrets } from './modules/secrets'
import { session } from './modules/session'
import * as Session from './modules/session/service'
import { sessionAwait } from './modules/session-await'
import { sessionEnvironment } from './modules/session-environment'
import { sessionGroup } from './modules/session-group'
import { skills } from './modules/skills'
import { storage } from './modules/storage'
import { registerSyncGatewayRoutes } from './modules/sync-gateway'
import { testReset } from './modules/test-reset'
import { threadHandoff } from './modules/thread-handoff'
import { turnCheckpoint } from './modules/turn-checkpoint'
import * as TurnCheckpoint from './modules/turn-checkpoint/service'
import { usage } from './modules/usage'
import { flushUsageWriteBehind } from './modules/usage/write-behind'
import { sessionWork, work } from './modules/work'
import { workflowRules } from './modules/workflow-rules'
import { workspace } from './modules/workspace'
import { registerWorkspaceGitIdentityBackfillMaintenance } from './modules/workspace/repo-identity-backfill'
import { worktree } from './modules/worktree'
import * as Worktree from './modules/worktree/service'
import { RuntimeResourceRegistry } from './runtime-resource-registry'

interface CreateServerAppOptions {
  startBackgroundTasks?: boolean
  bootstrapReporter?: ServerBootstrapReporter
}

interface CreateServerContractAppOptions {
  includeRuntimeHttpPlugins?: boolean
  downloadCenterService?: DownloadCenterService
  managedResourceService?: ManagedResourceService
  opencodeRuntimeInstallationService?: OpencodeRuntimeInstallationService
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

async function runBootstrapPhase<T>(
  reporter: ServerBootstrapReporter | undefined,
  phase: Parameters<ServerBootstrapReporter['run']>[0],
  operation: () => Promise<T>,
): Promise<T> {
  return reporter ? reporter.run(phase, operation) : operation()
}

export async function createServerContractApp(options: CreateServerContractAppOptions = {}) {
  registerChatRuntimeSessionLifecycleHandlers()
  configureProviderExtensionHost({
    findActiveRunId: (providerTargetId) => {
      const activeRun = runRegistry.listActiveRuns()
        .find(run => run.providerTargetId === providerTargetId)
      return activeRun?.runId ?? null
    },
    releaseRuntimeSessions: releaseLiveProviderRuntimeSessionsForProviderTarget,
    validateRefreshableCredential: (credentialRef, value) => Boolean(
      readCodexChatgptAuthCredential(credentialRef, value),
    ),
  })
  setGitHubAuthProvider(GitHubAuth.resolveGitHubAppIdentity)
  registerTurnCheckpointHooks({
    captureStart: async (input) => {
      await TurnCheckpoint.captureRunStart(input)
    },
    captureEnd: async (input) => {
      await TurnCheckpoint.captureRunEnd(input)
    },
  })
  Session.registerSessionDeletingHandler(TurnCheckpoint.prepareSessionDeletion)
  const { includeRuntimeHttpPlugins = false } = options
  const downloadCenter = createDownloadCenterModule(options.downloadCenterService)
  const chronicle = createChronicleModule(downloadCenter.service)
  const opencodeRuntimeInstallation
    = options.opencodeRuntimeInstallationService
      ?? new OpencodeRuntimeInstallationService({ downloadCenter: downloadCenter.service })
  const managedResources
    = options.managedResourceService
      ?? new ManagedResourceService([
      createChronicleManagedResourceAdapter(downloadCenter.service),
      createOpencodeManagedResourceAdapter(opencodeRuntimeInstallation),
    ])
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
        'x-cradle-telemetry-session-id',
        'x-cradle-telemetry-run-id',
      ],
    }),
  )
  app.use(createRequestIdPlugin())
  app.use(createAuthPlugin({
    ...loadServerAuthConfig(),
    listRelayAuthTokens: () => [...listActiveFabricNodeAuthTokens()],
  }))
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
  app.use(codeActivity)
  app.use(filesystem)
  app.use(usage)
  app.use(profiles)
  app.use(providerTargets)
  app.use(providerExtensions)
  app.use(fabric)
  app.use(createFabricNodeRoutes(getFabricNodeLinkManager()))
  app.use(externalIssueSources)
  app.use(githubAuth)
  app.use(externalProviderSources)
  app.use(externalSessionImport)
  app.use(secrets)
  app.use(modelRegistry)
  app.use(mcpServers)
  app.use(providers)
  app.use(providerPresets)
  app.use(agentIdentity)
  app.use(automation)
  app.use(assets)
  app.use(blobStore)
  app.use(chatArtifacts)
  app.use(backgroundActivity)
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
  app.use(javascriptEval)
  app.use(issue)
  app.use(imageOcr)
  app.use(kanban)
  app.use(linkPreview)
  app.use(search)
  app.use(recall)
  app.use(createPluginsModule({ downloadCenter: downloadCenter.service }))
  app.use(skills)
  app.use(storage)
  app.use(workflowRules)
  app.use(git)
  app.use(worktree)
  app.use(diffReview)
  app.use(createAcpModule(downloadCenter.service))
  // Projected remote sessions: transparent upstream for all /chat/sessions/:id/* paths
  // (including event routes mounted separately below).
  app.use(linkedChatSessionProxyPlugin)
  app.use(chatRuntimeGlobalEventRoutes)
  app.use(chatRuntimeEventRoutes)
  app.use(chatRuntime)
  app.use(conversationBridge)
  app.use(chronicle)
  app.use(createManagedResourcesModule(managedResources))
  app.use(opencodeServer)
  app.use(kimiServer)
  app.use(codexAppServer)
  app.use(agentInteractionRuntime)
  app.use(desktop)
  app.use(downloadCenter.routes)
  registerFabricWebSocketRoutes(app, getFabricNodeLinkManager())
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
  assertRelayCompressionRuntimeSupport()
  const { startBackgroundTasks = process.env.NODE_ENV !== 'test', bootstrapReporter } = options
  const downloadCenterService = new DownloadCenterService()
  initializeDatabase(bootstrapReporter)

  await runBootstrapPhase(bootstrapReporter, 'persisted-run-recovery', async () => {
    const { recoverPersistedRunProjections } = await import('./modules/chat-runtime/runtime')
    await recoverPersistedRunProjections()
  })

  await runBootstrapPhase(bootstrapReporter, 'recall-projection', async () => {
    const { initializeRecallProjection } = await import('./modules/recall')
    initializeRecallProjection()
  })

  const [
    app,
    managedResourceService,
    opencodeRuntimeInstallationService,
    serverConfig,
    runtime,
  ] = await runBootstrapPhase(bootstrapReporter, 'service-initialization', async () => {
    await downloadCenterService.boot()
    const [
      { abortAllRuns, flushAllActiveRunSnapshots },
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
      { prepareOpencodeManagedPathForRemoval, stopOpencodeServer },
      { shutdownImageOcr },
      { CodexUsageReconciliationScheduler },
      { registerRunSnapshotMaintenance },
      { hydrateCustomMcpServers },
    ] = await Promise.all([
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
      import('./modules/chat-runtime-providers/opencode/runtime-context'),
      import('./modules/image-ocr/service'),
      import('./modules/chat-runtime-providers/codex/usage-reconciliation-scheduler'),
      import('./modules/chat-runtime/run-snapshot-maintenance'),
      import('./modules/mcp-servers/service'),
    ])
    const opencodeRuntimeInstallationService = new OpencodeRuntimeInstallationService({
      downloadCenter: downloadCenterService,
      prepareManagedPathForRemoval: prepareOpencodeManagedPathForRemoval,
    })
    await opencodeRuntimeInstallationService.boot()
    const managedResourceService = new ManagedResourceService([
      createChronicleManagedResourceAdapter(downloadCenterService),
      createOpencodeManagedResourceAdapter(opencodeRuntimeInstallationService),
    ])
    chronicleService.startMemoryEmbeddingIndexer()
    chronicleService.reconcileMemoryEmbeddingCandidateIndex()
    const app = await createServerContractApp({
      includeRuntimeHttpPlugins: true,
      downloadCenterService,
      managedResourceService,
      opencodeRuntimeInstallationService,
    })
    Health.check()
    Worktree.registerStorageMeasurementActivity({
      hasActiveOrPendingRuns: () => runRegistry.hasActiveOrPendingRuns(),
      readServerCpuPercent: () => Health.check().cpu.percent,
    })
    GitHubCache.registerGithubCacheMaintenance()
    ComposerDrafts.registerComposerDraftMaintenance()
    registerRunSnapshotMaintenance()
    TurnCheckpoint.registerTurnCheckpointMaintenance()
    registerBlobStoreMaintenance()
    registerMessageBlobBackfillMaintenance()
    registerMessageSteerSplitBackfillMaintenance()
    registerWorkspaceGitIdentityBackfillMaintenance()
    registerCodexResetWatchMaintenance()
    Maintenance.registerTask({
      ownerNamespace: 'logging',
      key: 'rotate-server-log',
      title: 'Rotate server log',
      intervalMs: 15 * 60 * 1000,
      runOnStart: true,
      manuallyRunnable: true,
      run: () => ({ ...rotateServerLog() }),
    })
    Maintenance.registerTask({
      ownerNamespace: 'database',
      key: 'compact',
      title: 'Compact database',
      priority: 'normal',
      intervalMs: null,
      runOnStart: false,
      manuallyRunnable: true,
      run: () => {
        if (runRegistry.hasActiveOrPendingRuns()) {
          throw new Error('Database compaction cannot run while chat runs are active or starting')
        }
        return { ...compactDatabase() }
      },
    })
    registerAgentToolsMcpServer()
    const serverConfig = getServerConfig()
    return [
      app,
      managedResourceService,
      opencodeRuntimeInstallationService,
      serverConfig,
      {
        abortAllRuns,
        flushAllActiveRunSnapshots,
        shutdownTraceStreams,
        chronicleCleanup,
        chronicleService,
        refreshAllExternalProviderSources,
        reconcileExternalIssueSourceRegistrations,
        providerRuntimeHostManager,
        clearSideConversations,
        activateServerPlugins,
        deactivateAllPlugins,
        conversationBridgeSupervisor,
        destroyWorkspaceFileIndexes,
        stopOpencodeServer,
        shutdownImageOcr,
        CodexUsageReconciliationScheduler,
        hydrateCustomMcpServers,
      },
    ] as const
  })

  const {
    abortAllRuns,
    flushAllActiveRunSnapshots,
    shutdownTraceStreams,
    chronicleCleanup,
    chronicleService,
    refreshAllExternalProviderSources,
    reconcileExternalIssueSourceRegistrations,
    providerRuntimeHostManager,
    clearSideConversations,
    activateServerPlugins,
    deactivateAllPlugins,
    conversationBridgeSupervisor,
    destroyWorkspaceFileIndexes,
    stopOpencodeServer,
    shutdownImageOcr,
    CodexUsageReconciliationScheduler,
    hydrateCustomMcpServers,
  } = runtime

  await runBootstrapPhase(bootstrapReporter, 'plugin-activation', async () => {
    await activateServerPlugins(app, {
      hostServices: {
        downloadCenter: downloadCenterService,
        managedResources: managedResourceService,
        dataDir: serverConfig.dataDir ?? dirname(serverConfig.dbPath),
      },
    })
    await hydrateCustomMcpServers()
    reconcileExternalIssueSourceRegistrations()
  })

  const runtimeResources = new RuntimeResourceRegistry()
  const fabricNodeConnector = new FabricNodeConnector('127.0.0.1', serverConfig.port)
  const unregisterFabricMembershipChangedListener = startBackgroundTasks
    ? registerFabricMembershipChangedListener(() => {
      fabricNodeConnector.stop()
      fabricNodeConnector.start()
    })
    : undefined
  const claudeUsageReconciliation = new ClaudeUsageReconciliationScheduler()
  const codexUsageReconciliation = new CodexUsageReconciliationScheduler()
  runtimeResources.register({
    name: 'run-snapshot-write-behind',
    phase: 'drain',
    stop: flushRunSnapshotWriteBehind,
  })
  runtimeResources.register({
    name: 'usage-write-behind',
    phase: 'drain',
    stop: flushUsageWriteBehind,
  })
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
    name: 'maintenance',
    phase: 'cancel',
    stop: () => Maintenance.stop(),
  })
  runtimeResources.register({
    name: 'background-activity',
    phase: 'cancel',
    stop: () => BackgroundActivity.stop(),
  })
  runtimeResources.register({
    name: 'opencode-runtime-installation',
    phase: 'drain',
    stop: () => opencodeRuntimeInstallationService.shutdown(),
  })
  runtimeResources.register({
    name: 'claude-usage-reconciliation',
    phase: 'cancel',
    stop: () => claudeUsageReconciliation.stop(),
  })
  runtimeResources.register({
    name: 'codex-usage-reconciliation',
    phase: 'cancel',
    stop: () => codexUsageReconciliation.stop(),
  })
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
    name: 'chat-runtime-providers',
    phase: 'stop',
    stop: () => getRuntimeRegistry().disposeAll(),
  })
  runtimeResources.register({
    name: 'provider-runtime',
    phase: 'stop',
    stop: () => providerRuntimeHostManager.shutdown(),
  })
  runtimeResources.register({ name: 'opencode-server', phase: 'stop', stop: stopOpencodeServer })
  runtimeResources.register({
    name: 'background-job-poller',
    phase: 'cancel',
    stop: () => BackgroundJobPoller.stop(),
  })
  runtimeResources.register({
    name: 'fabric-node-connector',
    phase: 'cancel',
    stop: () => {
      unregisterFabricMembershipChangedListener?.()
      fabricNodeConnector.stop()
    },
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
  runtimeResources.register({
    name: 'chronicle-embedding-indexer',
    phase: 'drain',
    stop: () => chronicleService.stopMemoryEmbeddingIndexer(),
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
    claudeUsageReconciliation.start()
    codexUsageReconciliation.start()
    Maintenance.start()
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
    fabricNodeConnector.start()
  }

  return app
}
