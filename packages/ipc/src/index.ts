// Main-process exports (IpcService, IpcMethod, createServices, IpcHandler, getIpcContext)
export type { IpcContext, IpcServiceConstructor } from './base'
export {
  createServices,
  getIpcContext,
  IpcHandler,
  IpcMethod,
  IpcService,
  observePush,
  setIpcObserver,
} from './base'

// Renderer / preload export
export { createIpcProxy } from './client'

// Type utilities
export type { ExtractServiceMethods, MergeIpcService } from './utility'

// Shared IPC event model
export type {
  IpcObservedEvent,
  IpcObservedPayload,
  IpcObservedPhase,
  IpcObservedSide,
  IpcObservedStatus,
  IpcTraceEnvelope,
} from './events'
export {
  captureCallerStack,
  createObservedEvent,
  createTraceEnvelope,
  IPC_DEVTOOL_METADATA_KEY,
  IpcTraceEnvelopeSchema,
  serializeError,
  serializePayload,
} from './events'

// Shared ACP devtool event model
export type {
  AcpDevtoolEvent,
  AcpDevtoolEventKind,
  AcpDevtoolEventStream,
} from './acp-events'

// Shared Agent Context devtool event model
export type {
  AgentContextEvent,
} from './agent-context-events'

// Shared Observability devtool/event model
export type {
  ObservabilityCategory,
  ObservabilityDevtoolEvent,
  ObservabilityEvent,
  ObservabilityIncident,
  ObservabilitySeverity,
  ObservabilitySource,
} from './observability-events'
