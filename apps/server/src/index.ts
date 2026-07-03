import { flushLogger, getLogger, initializeLogger } from './logging/logger'
import type { CreateEventInput } from './modules/observability/contract'
import { OBSERVABILITY_CODES } from './modules/observability/contract'
import { flushEvents, record } from './modules/observability/service'
import { initializeTelemetry, shutdownTelemetry } from './telemetry'

interface RuntimeServer {
  stop: () => void | Promise<void>
}

function serializeRuntimeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack
    }
  }
  return { value: String(err) }
}

async function recordFatalError(
  message: string,
  err: unknown,
  code: CreateEventInput['code'] = OBSERVABILITY_CODES.serverBootstrapFatal
): Promise<void> {
  const logger = getLogger()
  if (err instanceof Error) {
    logger.error(message, { err })
  } else {
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
        pid: process.pid
      }
    })
    await flushEvents()
  } catch (observabilityError) {
    logger.error('failed to persist fatal observability event', { err: observabilityError })
  }
  flushLogger()
}

function installProcessFatalHandlers(): void {
  process.on('unhandledRejection', (reason) => {
    void recordFatalError(
      'unhandled promise rejection',
      reason,
      OBSERVABILITY_CODES.serverUnhandledRejection
    ).finally(() => {
      process.exit(1)
    })
  })

  process.on('uncaughtException', (err) => {
    void recordFatalError(
      'uncaught exception',
      err,
      OBSERVABILITY_CODES.serverUncaughtException
    ).finally(() => {
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
  const [
    { createServerApp },
    { loadServerConfig },
    { warmupModelsDevCache },
    { recoverPersistedRunProjections }
  ] = await Promise.all([
    import('./app'),
    import('./config/server-config'),
    import('./modules/model-registry/model-info-registry'),
    import('./modules/chat-runtime/runtime')
  ])

  const config = loadServerConfig()
  const logger = getLogger()

  const app = await createServerApp()
  let runtimeServer: RuntimeServer | null = null

  app.listen(
    {
      port: config.port,
      hostname: config.host
    },
    (server) => {
      runtimeServer = server
      void recoverPersistedRunProjections().catch((error) => {
        logger.warn('failed to recover persisted run projections', { error })
      })
    }
  )

  // Pre-warm models.dev cache so first model list request is fast
  warmupModelsDevCache()

  logger.info(`listening on http://${config.host}:${config.port}`)

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
      desktopPid: process.env.CRADLE_DESKTOP_PID ?? null
    })
    try {
      if (runtimeServer) {
        await runtimeServer.stop()
      } else {
        await app.stop()
      }
      logger.info('graceful shutdown complete')
    } catch (err) {
      logger.error('error during graceful shutdown', { err })
    } finally {
      await shutdownTelemetry()
      flushLogger()
      process.exit(0)
    }
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
  process.on('SIGINT', () => gracefulShutdown('SIGINT'))
}

bootstrap().catch((err) => {
  void recordFatalError('fatal bootstrap error', err).finally(() => {
    void shutdownTelemetry()
    process.exit(1)
  })
})
