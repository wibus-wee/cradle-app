import { cors } from '@elysiajs/cors'
import { node } from '@elysiajs/node'
import { Elysia } from 'elysia'

import { createOpenApiPlugin, registerOpenApiAlias } from './http/openapi'
import { createRequestIdPlugin } from './http/request-id'
import { acp } from './modules/acp'
import { agentIdentity } from './modules/agent-identity'
import { agentInteractionRuntime } from './modules/agent-interaction-runtime'
import { automation } from './modules/automation'
import { assets } from './modules/assets'
import { chatRuntime } from './modules/chat-runtime'
import { chronicle } from './modules/chronicle'
import { conversationBridge } from './modules/conversation-bridge'
import { desktop } from './modules/desktop'
import { diffReview } from './modules/diff-review'
import { externalIssueSources } from './modules/external-issue-sources'
import { externalProviderSources } from './modules/external-provider-sources'
import { externalWorkImport } from './modules/external-work-import'
import { filesystem } from './modules/filesystem'
import { git } from './modules/git'
import { health } from './modules/health'
import { issue } from './modules/issue'
import { issueAgent } from './modules/issue-agent'
import { kanban } from './modules/kanban'
import { linkPreview } from './modules/link-preview'
import { modelRegistry } from './modules/model-registry'
import { observability } from './modules/observability'
import { plugins as pluginsApi } from './modules/plugins'
import { preferences } from './modules/preferences'
import { profiles } from './modules/profiles'
import { providers } from './modules/provider-catalog'
import { providerTargets } from './modules/provider-targets'
import { relayServers } from './modules/relay-servers'
import { remoteHosts } from './modules/remote-hosts'
import { registerPtyRoutes } from './modules/pty'
import { search } from './modules/search'
import { secrets } from './modules/secrets'
import { session } from './modules/session'
import { sessionAwait } from './modules/session-await'
import { skills } from './modules/skills'
import { testReset } from './modules/test-reset'
import { usage } from './modules/usage'
import { workflowRules } from './modules/workflow-rules'
import { workspace } from './modules/workspace'

interface CreateServerAppOptions {
  startBackgroundTasks?: boolean
  recoverPersistedRunsOnCreate?: boolean
}

interface CreateServerContractAppOptions {
  includeRuntimeHttpPlugins?: boolean
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
  const { includeRuntimeHttpPlugins = false } = options
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
      origin: isAllowedCorsOrigin,
      exposeHeaders: [
        'x-cradle-run-id',
        'x-cradle-assistant-message-id',
        'x-cradle-user-message-id',
      ],
    }),
  )
  app.use(createRequestIdPlugin())
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
  app.use(session)
  app.use(sessionAwait)
  app.use(issue)
  app.use(kanban)
  app.use(linkPreview)
  app.use(search)
  app.use(pluginsApi)
  app.use(skills)
  app.use(workflowRules)
  app.use(git)
  app.use(diffReview)
  app.use(acp)
  app.use(chatRuntime)
  app.use(conversationBridge)
  app.use(chronicle)
  app.use(agentInteractionRuntime)
  app.use(desktop)
  registerPtyRoutes(app)
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
  const [
    { shutdownInfra },
    { flushAllActiveRunSnapshots, recoverPersistedRunProjections },
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
  ] = await Promise.all([
    import('./infra'),
    import('./modules/chat-runtime/service'),
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
  ])
  if (recoverPersistedRunsOnCreate) {
    recoverPersistedRunProjections()
  }

  const app = await createServerContractApp({ includeRuntimeHttpPlugins: true })

  // Plugin system — discover and activate server plugins
  await activateServerPlugins(app)
  reconcileExternalIssueSourceRegistrations()

  app.onStop([
    () => flushAllActiveRunSnapshots(),
    () => clearSideConversations(),
    () => conversationBridgeSupervisor.stopAllConversationBridgeConnections(),
    () => deactivateAllPlugins(),
    () => providerRuntimeHostManager.shutdown(),
    () => localRelaydSupervisor.stopManagedLocalRelayd(),
    () => chronicleService.stopActivityPipelineScheduler(),
    () => chronicleService.stopSlackBackgroundSync(),
    () => chronicleCleanup(),
    () => shutdownTraceStreams(),
    () => destroyWorkspaceFileIndexes(),
    () => shutdownInfra(),
  ])

  // Start chronicle daemon if enabled
  if (startBackgroundTasks) {
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
    void conversationBridgeSupervisor.startEnabledConversationBridgeConnections()
    void localRelaydSupervisor.startManagedLocalRelayd()
  }

  return app
}
