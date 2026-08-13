export {
  applyDesktopServerReadyEndpoint,
  type DesktopServerConnectionKind,
  type DesktopServerConnectionProjection,
  getDesktopServerConnectionKind,
  getRendererServerUrl,
  getServerNetworkUrl,
  isCradleServerRequestUrl,
  isSameServerEndpoint,
  rebaseToServerBase,
  resetServerTransportBaseUrlStateForTests,
} from './base-url'
export {
  openServerEventSource,
  type OpenServerEventSourceOptions,
  type ServerEventSource,
  type ServerEventSourceErrorListener,
  type ServerEventSourceListener,
} from './fetch-event-source'
