import {
  captureCallerStack,
  createObservedEvent,
  createTraceEnvelope,
  serializeError,
  serializePayload,
} from './events'

/** Minimal interface — only `invoke` is required for the proxy. */
interface InvokableIpc {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
}

export interface IpcClientObserverOptions {
  captureStack?: boolean
  emit?: (event: ReturnType<typeof createObservedEvent>) => void
}

// eslint-disable-next-line ts/no-explicit-any
export function createIpcProxy<IpcServices extends Record<string, any>>(
  ipc: InvokableIpc | null,
  options: IpcClientObserverOptions = {},
): IpcServices | null {
  if (!ipc) {
    return null
  }

  return new Proxy({} as IpcServices, {
    get(_target, groupName: string) {
      return new Proxy(
        {},
        {
          get(_, methodName: string) {
            return async (...args: unknown[]) => {
              const channel = `${groupName}.${methodName}`
              const callerStack = options.captureStack ? captureCallerStack() : []
              const envelope = createTraceEnvelope(null, callerStack)

              options.emit?.(
                createObservedEvent({
                  traceId: envelope.traceId,
                  spanId: envelope.spanId,
                  parentSpanId: envelope.parentSpanId,
                  channel,
                  side: 'renderer',
                  phase: 'start',
                  status: 'pending',
                  startedAt: envelope.startedAt,
                  endedAt: null,
                  durationMs: null,
                  args: serializePayload(args),
                  result: null,
                  error: null,
                  callerStack,
                }),
              )

              try {
                const result = await ipc.invoke(channel, envelope, ...args)
                options.emit?.(
                  createObservedEvent({
                    traceId: envelope.traceId,
                    spanId: envelope.spanId,
                    parentSpanId: envelope.parentSpanId,
                    channel,
                    side: 'renderer',
                    phase: 'finish',
                    status: 'success',
                    startedAt: envelope.startedAt,
                    endedAt: Date.now(),
                    durationMs: Date.now() - envelope.startedAt,
                    args: serializePayload(args),
                    result: serializePayload(result),
                    error: null,
                    callerStack,
                  }),
                )
                return result
              }
 catch (error) {
                options.emit?.(
                  createObservedEvent({
                    traceId: envelope.traceId,
                    spanId: envelope.spanId,
                    parentSpanId: envelope.parentSpanId,
                    channel,
                    side: 'renderer',
                    phase: 'finish',
                    status: 'error',
                    startedAt: envelope.startedAt,
                    endedAt: Date.now(),
                    durationMs: Date.now() - envelope.startedAt,
                    args: serializePayload(args),
                    result: null,
                    error: serializeError(error),
                    callerStack,
                  }),
                )
                throw error
              }
            }
          },
        },
      )
    },
  })
}
