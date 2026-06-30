import { AsyncLocalStorage } from 'node:async_hooks'

import { context as otelContext, trace } from '@opentelemetry/api'
import type { IpcMainInvokeEvent, WebContents } from 'electron'
import { ipcMain } from 'electron'
import { z } from 'zod'

import {
  createObservedEvent,
  IpcTraceEnvelopeSchema,
  markSpanError,
  markSpanSuccess,
  serializeError,
  serializePayload,
} from './events'

const HYPHEN_RE = /-/g

const IpcInvocationArgsSchema = z.union([
  z.tuple([IpcTraceEnvelopeSchema]).rest(z.unknown()).transform(([traceEnvelope, ...handlerArgs]) => ({
    traceEnvelope,
    handlerArgs,
  })),
  z.array(z.unknown()).transform(handlerArgs => ({
    traceEnvelope: null,
    handlerArgs,
  })),
])

// ── Context ───────────────────────────────────────────────────────────────────

export interface IpcContext {
  sender: WebContents
  event: IpcMainInvokeEvent
  traceId: string | null
  spanId: string | null
  parentSpanId: string | null
  callerStack: string[]
}

const contextStorage = new AsyncLocalStorage<IpcContext>()

let ipcObserver: ((event: ReturnType<typeof createObservedEvent>) => void) | null = null

export function setIpcObserver(observer: typeof ipcObserver): void {
  ipcObserver = observer
}

export function getIpcContext(): IpcContext {
  const context = contextStorage.getStore()
  if (!context) {
    throw new Error('IPC context is not available. Make sure this is called within an IPC handler.')
  }
  return context
}

/**
 * Instrument a one-way main → renderer push so it shows up in the IPC devtool
 * alongside request/response traces. Call this immediately before (or after)
 * `webContents.send(channel, payload)`. Safe no-op when no observer is attached.
 *
 * `flowId` is an optional logical grouping (e.g. chat session id) — events
 * that share a flowId are rendered as an ordered sequence in the devtool.
 */
export function observePush(
  channel: string,
  payload: unknown,
  options: {
    flowId?: string
    status?: 'success' | 'error'
  } = {},
): void {
  if (!ipcObserver) {
    return
  }
  const now = Date.now()
  const traceId = (typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${now}-${Math.random().toString(36).slice(2)}`).replace(HYPHEN_RE, '')
  const spanId = traceId.slice(0, 16)
  ipcObserver({
    id: traceId.slice(16, 32) || traceId,
    traceId,
    spanId,
    parentSpanId: null,
    channel,
    side: 'main',
    phase: 'finish',
    status: options.status ?? 'success',
    startedAt: now,
    endedAt: now,
    durationMs: 0,
    args: null,
    result: serializePayload(payload),
    error: null,
    callerStack: [],
    flowId: options.flowId,
  })
}

// ── Decorator metadata ────────────────────────────────────────────────────────

const IPC_METHODS_KEY = Symbol('ipcMethods')

// Polyfill: esbuild uses Symbol.for("Symbol.metadata") when Symbol.metadata is unavailable
const SymbolMetadata: typeof Symbol.metadata = Symbol.metadata ?? Symbol.for('Symbol.metadata')

// eslint-disable-next-line ts/no-explicit-any
export function IpcMethod(): (target: any, context: ClassMethodDecoratorContext) => void {
  // eslint-disable-next-line ts/no-explicit-any
  return function (_target: any, context: ClassMethodDecoratorContext) {
    const metadata = context.metadata
    if (!metadata[IPC_METHODS_KEY]) {
      metadata[IPC_METHODS_KEY] = []
    }
    ;(metadata[IPC_METHODS_KEY] as string[]).push(String(context.name))
  }
}

// ── Handler registry ──────────────────────────────────────────────────────────

export class IpcHandler {
  private static instance: IpcHandler
  private registeredChannels = new Set<string>()

  static getInstance(): IpcHandler {
    if (!IpcHandler.instance) {
      IpcHandler.instance = new IpcHandler()
    }
    return IpcHandler.instance
  }

  registerMethod<TOutput>(
    channel: string,
    // eslint-disable-next-line ts/no-explicit-any
    handler: (...args: any[]) => Promise<TOutput> | TOutput,
  ): void {
    if (this.registeredChannels.has(channel)) {
      return
    }
    this.registeredChannels.add(channel)

    ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      const { traceEnvelope, handlerArgs } = IpcInvocationArgsSchema.parse(args)
      const startedAt = traceEnvelope?.startedAt ?? Date.now()
      const span = trace.getTracer('cradle.ipc-devtool').startSpan(channel, {
        attributes: {
          'ipc.channel': channel,
          'ipc.side': 'main',
        },
      })

      const context: IpcContext = {
        sender: event.sender,
        event,
        traceId: traceEnvelope?.traceId ?? null,
        spanId: traceEnvelope?.spanId ?? null,
        parentSpanId: traceEnvelope?.parentSpanId ?? null,
        callerStack: traceEnvelope?.callerStack ?? [],
      }

      ipcObserver?.(
        createObservedEvent({
          traceId: traceEnvelope?.traceId ?? 'local',
          spanId: traceEnvelope?.spanId ?? 'local',
          parentSpanId: traceEnvelope?.parentSpanId ?? null,
          channel,
          side: 'main',
          phase: 'start',
          status: 'pending',
          startedAt,
          endedAt: null,
          durationMs: null,
          args: serializePayload(handlerArgs),
          result: null,
          error: null,
          callerStack: traceEnvelope?.callerStack ?? [],
        }),
      )

      try {
        const result = await contextStorage.run(context, () =>
          otelContext.with(trace.setSpan(otelContext.active(), span), () => handler(...handlerArgs)))

        markSpanSuccess()
        ipcObserver?.(
          createObservedEvent({
            traceId: traceEnvelope?.traceId ?? 'local',
            spanId: traceEnvelope?.spanId ?? 'local',
            parentSpanId: traceEnvelope?.parentSpanId ?? null,
            channel,
            side: 'main',
            phase: 'finish',
            status: 'success',
            startedAt,
            endedAt: Date.now(),
            durationMs: Date.now() - startedAt,
            args: serializePayload(handlerArgs),
            result: serializePayload(result),
            error: null,
            callerStack: traceEnvelope?.callerStack ?? [],
          }),
        )

        return result
      }
 catch (error) {
        markSpanError(error)
        ipcObserver?.(
          createObservedEvent({
            traceId: traceEnvelope?.traceId ?? 'local',
            spanId: traceEnvelope?.spanId ?? 'local',
            parentSpanId: traceEnvelope?.parentSpanId ?? null,
            channel,
            side: 'main',
            phase: 'finish',
            status: 'error',
            startedAt,
            endedAt: Date.now(),
            durationMs: Date.now() - startedAt,
            args: serializePayload(handlerArgs),
            result: null,
            error: serializeError(error),
            callerStack: traceEnvelope?.callerStack ?? [],
          }),
        )
        console.error(`Error in IPC method ${channel}:`, error)
        throw error
      }
    })
  }

  sendToRenderer<T = unknown>(webContents: WebContents, channel: string, data: T): void {
    webContents.send(channel, data)
  }
}

// ── Service base class ────────────────────────────────────────────────────────

export abstract class IpcService {
  protected handler = IpcHandler.getInstance()
  static readonly groupName: string

  constructor() {
    this.registerMethods()
  }

  protected registerMethods(): void {
    // eslint-disable-next-line ts/no-explicit-any
    const metadata = (this.constructor as any)[SymbolMetadata]
    const methods = metadata?.[IPC_METHODS_KEY] as string[] | undefined
    if (!methods) {
      return
    }
    for (const methodName of methods) {
      // eslint-disable-next-line ts/no-explicit-any
      const method = (this as any)[methodName]
      if (typeof method === 'function') {
        this.registerMethod(methodName, method.bind(this))
      }
    }
  }

  protected registerMethod<TOutput>(
    methodName: string,
    // eslint-disable-next-line ts/no-explicit-any
    handler: (...args: any[]) => Promise<TOutput> | TOutput,
  ): void {
    const groupName = (this.constructor as typeof IpcService).groupName
    this.handler.registerMethod(`${groupName}.${methodName}`, handler)
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export interface IpcServiceConstructor {
  new (): IpcService
  readonly groupName: string
}

export type IpcServiceDefinition = IpcServiceConstructor | IpcService

type CreateServicesConstructorsResult<T extends readonly IpcServiceConstructor[]> = {
  [K in T[number] as K['groupName']]: InstanceType<K>
}

function isServiceInstance(definition: IpcServiceDefinition): definition is IpcService {
  return definition instanceof IpcService
}

export function createServices<T extends readonly IpcServiceConstructor[]>(
  serviceDefinitions: T,
): CreateServicesConstructorsResult<T>

export function createServices(
  serviceDefinitions: readonly IpcServiceDefinition[],
): Record<string, IpcService>

export function createServices(
  serviceDefinitions: readonly IpcServiceDefinition[],
): Record<string, IpcService> {
  const services: Record<string, IpcService> = {}
  for (const definition of serviceDefinitions) {
    const service = isServiceInstance(definition)
      ? definition
      // eslint-disable-next-line new-cap
      : new definition()
    const ServiceConstructor = service.constructor as typeof IpcService

    if (!ServiceConstructor.groupName) {
      throw new Error(`Service ${ServiceConstructor.name} must define a static readonly groupName.`)
    }
    services[ServiceConstructor.groupName] = service
  }
  return services
}
