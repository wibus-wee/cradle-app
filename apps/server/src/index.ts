import { ServerBootstrapReporter } from './bootstrap-lifecycle'
import { flushLogger, getLogger, initializeLogger } from './logging/logger'
import type { CreateEventInput } from './modules/observability/contract'
import { OBSERVABILITY_CODES } from './modules/observability/contract'
import { flushEvents, record } from './modules/observability/service'
import { initializeTelemetry, shutdownTelemetry } from './telemetry'

interface RuntimeServer {
  stop: () => void | Promise<void>
}

interface RuntimeApp {
  stop: () => unknown | Promise<unknown>
}

let activeRuntimeApp: RuntimeApp | null = null
let activeRuntimeServer: RuntimeServer | null = null
let fatalShutdownStarted = false

function serializeRuntimeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
    }
  }
  return { value: String(err) }
}

async function recordFatalError(
  message: string,
  err: unknown,
  code: CreateEventInput['code'] = OBSERVABILITY_CODES.serverBootstrapFatal,
): Promise<void> {
  const logger = getLogger()
  if (err instanceof Error) {
    logger.error(message, { err })
  }
 else {
    logger.error(message, { reason: err })
  }
  try {
    record({
      source: 'server',
      code,
      severity: 'fatal',
      category: 'system',
      message,
      attrs: {
        error: serializeRuntimeError(err),
        pid: process.pid,
      },
    })
    await flushEvents()
  }
 catch (observabilityError) {
    logger.error('failed to persist fatal observability event', { err: observabilityError })
  }
  flushLogger()
}

async function stopActiveRuntimeBeforeExit(): Promise<void> {
  if (fatalShutdownStarted) {
    return
  }
  fatalShutdownStarted = true
  try {
    if (activeRuntimeServer) {
      await activeRuntimeServer.stop()
      return
    }
    await activeRuntimeApp?.stop()
  }
 catch (err) {
    getLogger().error('failed to stop runtime during fatal shutdown', { err })
  }
}

function installProcessFatalHandlers(): void {
  process.on('unhandledRejection', (reason) => {
    void recordFatalError(
      'unhandled promise rejection',
      reason,
      OBSERVABILITY_CODES.serverUnhandledRejection,
    ).finally(async () => {
      await stopActiveRuntimeBeforeExit()
      await shutdownTelemetry()
      flushLogger()
      process.exit(1)
    })
  })

  process.on('uncaughtException', (err) => {
    void recordFatalError(
      'uncaught exception',
      err,
      OBSERVABILITY_CODES.serverUncaughtException,
    ).finally(async () => {
      await stopActiveRuntimeBeforeExit()
      await shutdownTelemetry()
      flushLogger()
      process.exit(1)
    })
  })

  process.on('warning', (warning) => {
    getLogger().warn('process warning', { err: warning })
    flushLogger()
  })
}

async function bootstrap() {
  initializeLogger()
  await initializeTelemetry()
  installProcessFatalHandlers()
  const bootstrapReporter = new ServerBootstrapReporter()
  const [{ createServerApp }, { loadServerConfig }, { warmupModelsDevCache }] = await Promise.all([
    import('./app'),
    import('./config/server-config'),
    import('./modules/model-registry/model-info-registry'),
  ])

  const config = loadServerConfig()
  const logger = getLogger()

  const app = await createServerApp({ bootstrapReporter })
  activeRuntimeApp = app
  let runtimeServer: RuntimeServer | null = null

  bootstrapReporter.started('listener-establishment')
  try {
    app.listen(
      {
        port: config.port,
        hostname: config.host,
      },
      (server) => {
        runtimeServer = server
        activeRuntimeServer = server
        bootstrapReporter.completed('listener-establishment')
        bootstrapReporter.ready()
        logger.info(`listening on http://${config.host}:${config.port}`)
        // Force-refresh models.dev catalog on boot (SWR soft/hard TTL applies afterward)
        warmupModelsDevCache()
      },
    )
  }
 catch (error) {
    bootstrapReporter.failed('listener-establishment', error)
    throw error
  }

  let shutdownStarted = false
  const gracefulShutdown = async (signal: string) => {
    if (shutdownStarted) {
      return
    }
    shutdownStarted = true

    logger.info('received process signal, shutting down gracefully...', {
      signal,
      pid: process.pid,
      ppid: process.ppid,
      desktopPid: process.env.CRADLE_DESKTOP_PID ?? null,
    })
    try {
      if (runtimeServer) {
        await runtimeServer.stop()
      }
 else {
        await app.stop()
      }
      activeRuntimeServer = null
      activeRuntimeApp = null
      logger.info('graceful shutdown complete')
    }
 catch (err) {
      logger.error('error during graceful shutdown', { err })
    }
 finally {
      await shutdownTelemetry()
      flushLogger()
      process.exit(0)
    }
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
  process.on('SIGINT', () => gracefulShutdown('SIGINT'))
}

bootstrap().catch((err) => {
  void recordFatalError('fatal bootstrap error', err).finally(async () => {
    await stopActiveRuntimeBeforeExit()
    await shutdownTelemetry()
    flushLogger()
    process.exit(1)
  })
})
