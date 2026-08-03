export {
  applyDesktopServerReadyEndpoint,
  CRADLE_SERVER_LOCAL_BASE,
  type DesktopServerConnectionKind,
  type DesktopServerConnectionProjection,
  getDesktopServerConnectionKind,
  getRendererServerUrl,
  getServerNetworkUrl,
  isCradleServerLocalUrl,
  isCradleServerRequestUrl,
  isCustomSchemeProxyMode,
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
