import { isAbsolute } from 'node:path'

export const M0_ELECTRON_VERSION = '42.4.1'

export const REQUIRED_M0_ASSERTIONS = Object.freeze([
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
])

export const M0_SCHEME_REGISTRATION = Object.freeze({
  scheme: 'cradle-server',
  privileges: Object.freeze({
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    stream: true,
  }),
})

export const M0_SCHEME_PRIVILEGES = Object.freeze({
  ...M0_SCHEME_REGISTRATION.privileges,
  codeCache: false,
  bypassCSP: false,
  allowServiceWorkers: false,
  allowExtensions: false,
})

const M0_PLATFORMS = new Set(['darwin', 'linux', 'win32'])
const COUNTER_NAMES = Object.freeze([
  'activeRequests',
  'responseCancels',
  'upstreamCloses',
  'defaultSessionHits',
  'partitionHits',
  'requestSignalAborts',
  'cancelStreamChunks',
  'customSchemeModuleHits',
])
const KIB_PER_MIB = 1024

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateExactKeys(value, expectedKeys, path, errors) {
  const expected = new Set(expectedKeys)
  for (const key of expected) {
    if (!Object.hasOwn(value, key)) { errors.push(`${path}.${key} is required`) }
  }
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) { errors.push(`${path}.${key} is not allowed`) }
  }
}

function validateFiniteNumber(value, path, errors, { nonNegative = false, integer = false } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push(`${path} must be a finite number`)
    return false
  }
  if (nonNegative && value < 0) {
    errors.push(`${path} must be non-negative`)
    return false
  }
  if (integer && !Number.isInteger(value)) {
    errors.push(`${path} must be an integer`)
    return false
  }
  return true
}

function validateMemoryPair(value, path, errors) {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`)
    return undefined
  }
  validateExactKeys(value, ['main', 'renderer'], path, errors)
  const mainValid = validateFiniteNumber(value.main, `${path}.main`, errors, { nonNegative: true, integer: true })
  const rendererValid = validateFiniteNumber(value.renderer, `${path}.renderer`, errors, { nonNegative: true, integer: true })
  if (!mainValid || !rendererValid) { return undefined }
  return { main: value.main, renderer: value.renderer }
}

function validateMemoryTrace(value, path, errors) {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`)
    return undefined
  }
  validateExactKeys(value, ['baselineKiB', 'peakKiB', 'samples'], path, errors)
  const baselineKiB = validateMemoryPair(value.baselineKiB, `${path}.baselineKiB`, errors)
  const peakKiB = validateMemoryPair(value.peakKiB, `${path}.peakKiB`, errors)
  if (!Array.isArray(value.samples) || value.samples.length === 0) {
    errors.push(`${path}.samples must be a non-empty array`)
    return undefined
  }

  const samples = []
  let previousElapsedMs = -1
  for (const [index, sample] of value.samples.entries()) {
    const samplePath = `${path}.samples[${index}]`
    if (!isRecord(sample)) {
      errors.push(`${samplePath} must be an object`)
      continue
    }
    validateExactKeys(sample, ['elapsedMs', 'mainKiB', 'rendererKiB'], samplePath, errors)
    const elapsedValid = validateFiniteNumber(sample.elapsedMs, `${samplePath}.elapsedMs`, errors, { nonNegative: true, integer: true })
    const mainValid = validateFiniteNumber(sample.mainKiB, `${samplePath}.mainKiB`, errors, { nonNegative: true, integer: true })
    const rendererValid = validateFiniteNumber(sample.rendererKiB, `${samplePath}.rendererKiB`, errors, { nonNegative: true, integer: true })
    if (!elapsedValid || !mainValid || !rendererValid) { continue }
    if (sample.elapsedMs < previousElapsedMs) {
      errors.push(`${samplePath}.elapsedMs must be time-ordered`)
    }
    previousElapsedMs = sample.elapsedMs
    samples.push({
      elapsedMs: sample.elapsedMs,
      mainKiB: sample.mainKiB,
      rendererKiB: sample.rendererKiB,
    })
  }

  if (!baselineKiB || !peakKiB || samples.length !== value.samples.length) { return undefined }
  const first = samples[0]
  const rawPeak = samples.reduce((peak, sample) => ({
    main: Math.max(peak.main, sample.mainKiB),
    renderer: Math.max(peak.renderer, sample.rendererKiB),
  }), { main: first.mainKiB, renderer: first.rendererKiB })
  if (baselineKiB.main !== first.mainKiB || baselineKiB.renderer !== first.rendererKiB) {
    errors.push(`${path}.baselineKiB must match the first raw sample`)
  }
  if (peakKiB.main !== rawPeak.main || peakKiB.renderer !== rawPeak.renderer) {
    errors.push(`${path}.peakKiB must match the raw sample maxima`)
  }
  return { baselineKiB, peakKiB, samples }
}

function sameMemoryPair(left, right) {
  return left && right && left.main === right.main && left.renderer === right.renderer
}

function validateMemory(value, errors) {
  if (!isRecord(value)) {
    errors.push('memory must be an object')
    return undefined
  }
  validateExactKeys(value, [
    'chunkBytes',
    'baselineKiB',
    'peak64MiBKiB',
    'peak128MiBKiB',
    'settledKiB',
    'trace64MiB',
    'trace128MiB',
  ], 'memory', errors)
  if (value.chunkBytes !== 262144) { errors.push('memory.chunkBytes must be 262144') }
  const baselineKiB = validateMemoryPair(value.baselineKiB, 'memory.baselineKiB', errors)
  const peak64MiBKiB = validateMemoryPair(value.peak64MiBKiB, 'memory.peak64MiBKiB', errors)
  const peak128MiBKiB = validateMemoryPair(value.peak128MiBKiB, 'memory.peak128MiBKiB', errors)
  const settledKiB = validateMemoryPair(value.settledKiB, 'memory.settledKiB', errors)
  const trace64MiB = validateMemoryTrace(value.trace64MiB, 'memory.trace64MiB', errors)
  const trace128MiB = validateMemoryTrace(value.trace128MiB, 'memory.trace128MiB', errors)

  if (baselineKiB && trace64MiB && !sameMemoryPair(baselineKiB, trace64MiB.baselineKiB)) {
    errors.push('memory.baselineKiB must match memory.trace64MiB.baselineKiB')
  }
  if (peak64MiBKiB && trace64MiB && !sameMemoryPair(peak64MiBKiB, trace64MiB.peakKiB)) {
    errors.push('memory.peak64MiBKiB must match memory.trace64MiB.peakKiB')
  }
  if (peak128MiBKiB && trace128MiB && !sameMemoryPair(peak128MiBKiB, trace128MiB.peakKiB)) {
    errors.push('memory.peak128MiBKiB must match memory.trace128MiB.peakKiB')
  }
  if (!baselineKiB || !peak64MiBKiB || !peak128MiBKiB || !settledKiB || !trace64MiB || !trace128MiB) {
    return undefined
  }
  return { baselineKiB, peak64MiBKiB, peak128MiBKiB, settledKiB, trace64MiB, trace128MiB }
}

function validateAssertions(value, errors) {
  if (!isRecord(value)) {
    errors.push('assertions must be an object')
    return undefined
  }
  validateExactKeys(value, REQUIRED_M0_ASSERTIONS, 'assertions', errors)
  for (const name of REQUIRED_M0_ASSERTIONS) {
    const assertion = value[name]
    if (!isRecord(assertion)) {
      errors.push(`missing assertion: ${name}`)
      continue
    }
    validateExactKeys(assertion, ['passed', 'details'], `assertions.${name}`, errors)
    if (assertion.passed !== true) { errors.push(`assertion failed: ${name}`) }
    if (!isRecord(assertion.details)) {
      errors.push(`assertions.${name}.details must be an object`)
      continue
    }
    if (Object.keys(assertion.details).length === 0) {
      errors.push(`assertions.${name}.details must not be empty`)
    }
    for (const [detailName, detail] of Object.entries(assertion.details)) {
      const validPrimitive = typeof detail === 'string' || typeof detail === 'boolean'
      if (!validPrimitive && !validateFiniteNumber(detail, `assertions.${name}.details.${detailName}`, errors, { nonNegative: true })) {
        continue
      }
    }
  }
  return value
}

function validateCounters(value, errors) {
  if (!isRecord(value)) {
    errors.push('counters must be an object')
    return undefined
  }
  validateExactKeys(value, COUNTER_NAMES, 'counters', errors)
  let valid = true
  for (const name of COUNTER_NAMES) {
    valid = validateFiniteNumber(value[name], `counters.${name}`, errors, { nonNegative: true, integer: true }) && valid
  }
  if (!valid) { return undefined }
  if (value.activeRequests !== 0) { errors.push('counters.activeRequests must be 0') }
  if (value.responseCancels !== 1) { errors.push('counters.responseCancels must be 1') }
  if (value.upstreamCloses !== 1) { errors.push('counters.upstreamCloses must be 1') }
  if (value.defaultSessionHits === 0) { errors.push('counters.defaultSessionHits must be greater than 0') }
  if (value.partitionHits !== 0) { errors.push('counters.partitionHits must be 0') }
  if (value.requestSignalAborts === 0) { errors.push('counters.requestSignalAborts must be greater than 0') }
  if (value.cancelStreamChunks === 0) { errors.push('counters.cancelStreamChunks must be greater than 0') }
  if (value.customSchemeModuleHits < 3) { errors.push('counters.customSchemeModuleHits must be at least 3') }
  return value
}

function requireDetail(assertions, assertionName, detailName, expectedValue, errors) {
  const actual = assertions?.[assertionName]?.details?.[detailName]
  if (actual !== expectedValue) {
    errors.push(`assertions.${assertionName}.details.${detailName} must be ${String(expectedValue)}`)
  }
}

function validateEvidenceInvariants(value, assertions, memory, counters, errors) {
  if (!assertions || !memory || !counters) { return }
  requireDetail(assertions, 'scheme.privileges.exact', 'enabledPrivileges', 5, errors)
  requireDetail(assertions, 'scheme.privileges.exact', 'disabledPrivileges', 4, errors)
  requireDetail(assertions, 'scheme.defaultSession.handled', 'defaultSessionHandled', true, errors)
  requireDetail(assertions, 'scheme.browserPanelPartition.unhandled', 'partitionHits', counters.partitionHits, errors)
  requireDetail(assertions, 'response.cancel.invokedOnce', 'responseCancels', counters.responseCancels, errors)
  requireDetail(assertions, 'response.cancel.reachesUpstream', 'requestSignalAborts', counters.requestSignalAborts, errors)
  requireDetail(assertions, 'response.cancel.reachesUpstream', 'upstreamCloses', counters.upstreamCloses, errors)
  requireDetail(assertions, 'response.cancel.reachesUpstream', 'activeRequests', counters.activeRequests, errors)
  requireDetail(assertions, 'response.cancel.reachesUpstream', 'stableChunks', counters.cancelStreamChunks, errors)
  requireDetail(assertions, 'subresource.dynamicModule.dependenciesStayCustomScheme', 'customSchemeModuleHits', counters.customSchemeModuleHits, errors)
  requireDetail(assertions, 'security.noBypassCsp', 'bypassCSP', false, errors)
  requireDetail(assertions, 'cleanup.activeRequestsZero', 'proxyActiveRequests', 0, errors)
  requireDetail(assertions, 'cleanup.activeRequestsZero', 'upstreamActiveRequests', 0, errors)
  requireDetail(assertions, 'cleanup.agentAndServerClosed', 'agentClosed', true, errors)
  requireDetail(assertions, 'cleanup.agentAndServerClosed', 'serverClosed', true, errors)

  const main64Delta = memory.peak64MiBKiB.main - memory.baselineKiB.main
  const renderer64Delta = memory.peak64MiBKiB.renderer - memory.baselineKiB.renderer
  const main128Delta = memory.trace128MiB.peakKiB.main - memory.trace128MiB.baselineKiB.main
  const renderer128Delta = memory.trace128MiB.peakKiB.renderer - memory.trace128MiB.baselineKiB.renderer
  const gateApplied = value.platform !== 'darwin'
  requireDetail(assertions, 'binary.64MiB.digestAndLength', 'bytes', 64 * KIB_PER_MIB * KIB_PER_MIB, errors)
  requireDetail(assertions, 'binary.64MiB.mainRssBound', 'deltaKiB', main64Delta, errors)
  requireDetail(assertions, 'binary.64MiB.mainRssBound', 'gateApplied', gateApplied, errors)
  requireDetail(assertions, 'binary.64MiB.rendererRssBound', 'deltaKiB', renderer64Delta, errors)
  requireDetail(assertions, 'binary.64MiB.rendererRssBound', 'gateApplied', gateApplied, errors)
  requireDetail(assertions, 'binary.128MiB.nonLinearMainRss', 'bytes', 128 * KIB_PER_MIB * KIB_PER_MIB, errors)
  requireDetail(assertions, 'binary.128MiB.nonLinearMainRss', 'delta64KiB', main64Delta, errors)
  requireDetail(assertions, 'binary.128MiB.nonLinearMainRss', 'delta128KiB', main128Delta, errors)
  requireDetail(assertions, 'binary.128MiB.nonLinearMainRss', 'gateApplied', gateApplied, errors)
  requireDetail(assertions, 'binary.128MiB.nonLinearRendererRss', 'delta64KiB', renderer64Delta, errors)
  requireDetail(assertions, 'binary.128MiB.nonLinearRendererRss', 'delta128KiB', renderer128Delta, errors)
  requireDetail(assertions, 'binary.128MiB.nonLinearRendererRss', 'gateApplied', gateApplied, errors)

  if (gateApplied) {
    if (main64Delta >= 48 * KIB_PER_MIB) { errors.push('raw Main 64 MiB RSS delta must be below 48 MiB') }
    if (renderer64Delta >= 48 * KIB_PER_MIB) { errors.push('raw renderer 64 MiB RSS delta must be below 48 MiB') }
    if (main128Delta > main64Delta + 16 * KIB_PER_MIB) { errors.push('raw Main 128 MiB RSS delta exceeds the non-linear bound') }
    if (renderer128Delta > renderer64Delta + 16 * KIB_PER_MIB) { errors.push('raw renderer 128 MiB RSS delta exceeds the non-linear bound') }
  }
}

export function validateM0Result(value, expected = {}) {
  const errors = []
  if (!isRecord(value)) {
    return { ok: false, errors: ['result must be an object'] }
  }
  validateExactKeys(value, [
    'schemaVersion',
    'passed',
    'mode',
    'electronVersion',
    'platform',
    'arch',
    'artifactPath',
    'schemePrivileges',
    'assertions',
    'memory',
    'counters',
    'launch',
  ], 'result', errors)

  if (value.schemaVersion !== 1) { errors.push('schemaVersion must be 1') }
  if (value.passed !== true) { errors.push('passed must be true') }
  if (value.electronVersion !== M0_ELECTRON_VERSION) {
    errors.push(`electronVersion must be ${M0_ELECTRON_VERSION}`)
  }
  if (expected.mode && value.mode !== expected.mode) {
    errors.push(`mode must be ${expected.mode}`)
  }
  if (value.mode !== 'development' && value.mode !== 'packaged') {
    errors.push('mode must be development or packaged')
  }
  if (!M0_PLATFORMS.has(value.platform)) {
    errors.push('platform must be darwin, linux, or win32')
  }
  if (expected.platform && value.platform !== expected.platform) {
    errors.push(`platform must be ${expected.platform}`)
  }
  if (typeof value.arch !== 'string' || !/^[\w-]+$/.test(value.arch)) {
    errors.push('arch must be a non-empty architecture string')
  }
  if (expected.arch && value.arch !== expected.arch) {
    errors.push(`arch must be ${expected.arch}`)
  }
  if (value.mode === 'development' && value.artifactPath !== null) {
    errors.push('development artifactPath must be null')
  }
  if (value.mode === 'packaged' && (typeof value.artifactPath !== 'string' || value.artifactPath.length === 0 || !isAbsolute(value.artifactPath))) {
    errors.push('packaged artifactPath must be a non-empty absolute string')
  }
  if (expected.artifactPath !== undefined && value.artifactPath !== expected.artifactPath) {
    errors.push(`artifactPath must be ${String(expected.artifactPath)}`)
  }

  if (!isRecord(value.schemePrivileges)) {
    errors.push('schemePrivileges must be an object')
  }
  else {
    validateExactKeys(value.schemePrivileges, Object.keys(M0_SCHEME_PRIVILEGES), 'schemePrivileges', errors)
    for (const [key, expectedValue] of Object.entries(M0_SCHEME_PRIVILEGES)) {
      if (value.schemePrivileges[key] !== expectedValue) {
        errors.push(`schemePrivileges.${key} must be ${expectedValue}`)
      }
    }
  }

  const assertions = validateAssertions(value.assertions, errors)
  const memory = validateMemory(value.memory, errors)
  const counters = validateCounters(value.counters, errors)
  if (!isRecord(value.launch)) {
    errors.push('launch must be an object')
  }
  else {
    validateExactKeys(value.launch, ['noSandbox', 'rendererSandbox'], 'launch', errors)
    if (typeof value.launch.noSandbox !== 'boolean') { errors.push('launch.noSandbox must be a boolean') }
    if (expected.noSandbox !== undefined && value.launch.noSandbox !== expected.noSandbox) {
      errors.push(`launch.noSandbox must be ${expected.noSandbox}`)
    }
    if (value.launch.rendererSandbox !== true) { errors.push('launch.rendererSandbox must be true') }
  }
  validateEvidenceInvariants(value, assertions, memory, counters, errors)

  return { ok: errors.length === 0, errors }
}
