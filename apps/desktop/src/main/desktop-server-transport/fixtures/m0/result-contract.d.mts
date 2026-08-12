export const M0_ELECTRON_VERSION: '42.4.1'

export const REQUIRED_M0_ASSERTIONS: readonly [
  'scheme.privileges.exact',
  'scheme.defaultSession.handled',
  'scheme.browserPanelPartition.unhandled',
  'fetch.get.queryAndHeaders',
  'fetch.post.binaryBody',
  'fetch.non2xx.responseParity',
  'response.firstByteBeforeCompletion',
  'response.cancel.invokedOnce',
  'response.cancel.reachesUpstream',
  'request.streaming.multiChunk',
  'multipart.contentTypeAndBytes',
  'binary.64MiB.digestAndLength',
  'binary.64MiB.mainRssBound',
  'binary.64MiB.rendererRssBound',
  'binary.128MiB.nonLinearMainRss',
  'binary.128MiB.nonLinearRendererRss',
  'subresource.image.loads',
  'subresource.dynamicModule.simple',
  'subresource.dynamicModule.realPlugin',
  'subresource.dynamicModule.dependenciesStayCustomScheme',
  'subresource.pdf.arrayBufferReadable',
  'security.strictRepresentativeCsp',
  'security.noBypassCsp',
  'cleanup.activeRequestsZero',
  'cleanup.agentAndServerClosed',
]

export const M0_SCHEME_REGISTRATION: Readonly<{
  scheme: 'cradle-server'
  privileges: Readonly<{
    standard: true
    secure: true
    supportFetchAPI: true
    corsEnabled: true
    stream: true
  }>
}>

export const M0_SCHEME_PRIVILEGES: Readonly<{
  standard: true
  secure: true
  supportFetchAPI: true
  corsEnabled: true
  stream: true
  codeCache: false
  bypassCSP: false
  allowServiceWorkers: false
  allowExtensions: false
}>

export interface M0ResultValidation {
  ok: boolean
  errors: string[]
}

export function validateM0Result(
  value: object,
  expected?: {
    mode?: 'development' | 'packaged'
    artifactPath?: string | null
    platform?: NodeJS.Platform
    arch?: string
    noSandbox?: boolean
  },
): M0ResultValidation
