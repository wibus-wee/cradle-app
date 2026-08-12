import * as React from 'react'
import * as ReactJsxDevRuntime from 'react/jsx-dev-runtime'
import * as ReactJsxRuntime from 'react/jsx-runtime'
import * as ReactDom from 'react-dom'
import * as ReactDomClient from 'react-dom/client'

import type { M0PreloadApi } from '../preload'
import type {
  M0Assertion,
  M0AssertionName,
  M0MemoryTrace,
  M0RendererReport,
} from '../result-schema'

declare global {
  interface Window {
    m0: M0PreloadApi
  }
}

const CUSTOM_BASE = 'cradle-server://local'
const BINARY_CHUNK_BYTES = 256 * 1024
const MIB = 1024 * 1024
const assertions: Partial<Record<M0AssertionName | string, M0Assertion>> = {}

const emptyTrace = (): M0MemoryTrace => ({
  baselineKiB: { main: 0, renderer: 0 },
  peakKiB: { main: 0, renderer: 0 },
  samples: [],
})
let trace64MiB = emptyTrace()
let trace128MiB = emptyTrace()

function errorMessage(error: Error): string {
  return error.stack ?? error.message
}

function pass(name: M0AssertionName | string, details: Record<string, number | string | boolean> = {}) {
  assertions[name] = { passed: true, details }
}

function fail(name: M0AssertionName | string, error: Error) {
  assertions[name] = { passed: false, details: { error: errorMessage(error) } }
}

function check(condition: boolean, message: string): asserts condition {
  if (!condition) { throw new Error(message) }
}

async function capture(
  name: M0AssertionName | string,
  operation: () => Promise<Record<string, number | string | boolean>>,
) {
  try {
    pass(name, await operation())
  }
  catch (error) {
    fail(name, error instanceof Error ? error : new Error(String(error)))
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function sha256Hex(bytes: BufferSource): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')
}

async function runBasicFetchAssertions() {
  await capture('fetch.get.queryAndHeaders', async () => {
    const response = await fetch(`${CUSTOM_BASE}/get?value=m0`)
    const body = await response.json() as { method: string, value: string }
    check(response.status === 200, `GET status was ${response.status}`)
    check(response.headers.get('x-m0-upstream') === 'get', 'GET response header was not preserved')
    check(body.method === 'GET' && body.value === 'm0', 'GET method or query was not preserved')
    return { status: response.status, method: body.method, value: body.value }
  })

  await capture('fetch.post.binaryBody', async () => {
    const body = new Uint8Array([0, 255, 17, 34, 51, 68, 85, 102])
    const expectedSha256 = await sha256Hex(body)
    const response = await fetch(`${CUSTOM_BASE}/post`, { method: 'POST', body })
    const result = await response.json() as { length: number, sha256: string }
    check(result.length === body.length, `POST length was ${result.length}`)
    check(result.sha256 === expectedSha256, 'POST digest changed in transit')
    return { bytes: result.length, sha256: result.sha256 }
  })

  await capture('fetch.non2xx.responseParity', async () => {
    const response = await fetch(`${CUSTOM_BASE}/status`)
    const body = await response.text()
    check(response.status === 418, `non-2xx status was ${response.status}`)
    check(response.headers.get('x-m0-status') === 'teapot', 'non-2xx header was not preserved')
    check(body === 'm0-status-body', 'non-2xx body was not preserved')
    return { status: response.status, statusText: response.statusText, body }
  })
}

async function runResponseStreamingAssertion() {
  await capture('response.firstByteBeforeCompletion', async () => {
    const response = await fetch(`${CUSTOM_BASE}/response-stream`)
    check(response.body !== null, 'streaming response had no body')
    const reader = response.body.getReader()
    const first = await reader.read()
    const firstByteAt = performance.now()
    check(!first.done && first.value.byteLength > 0, 'streaming response did not deliver a first chunk')
    while (!(await reader.read()).done) {
      // Consume one chunk at a time without retaining body bytes.
    }
    const completedAt = performance.now()
    const leadMs = completedAt - firstByteAt
    check(leadMs >= 750, `response completed only ${leadMs.toFixed(1)}ms after first byte`)
    return { firstChunkBytes: first.value.byteLength, firstByteLeadMs: Math.round(leadMs) }
  })
}

async function runCancellationAssertions() {
  try {
    const controller = new AbortController()
    const response = await fetch(`${CUSTOM_BASE}/cancel-stream`, { signal: controller.signal })
    check(response.body !== null, 'cancellation response had no body')
    const reader = response.body.getReader()
    const first = await reader.read()
    check(!first.done && first.value.byteLength > 0, 'cancellation route did not produce a chunk')
    controller.abort('m0-renderer-cancel')
    await reader.read().catch(() => undefined)

    const deadline = performance.now() + 2_000
    let diagnostics = await window.m0.diagnostics()
    while (
      performance.now() < deadline
      && (
        diagnostics.responseCancels !== 1
        || diagnostics.requestSignalAborts < 1
        || diagnostics.upstreamCloses !== 1
        || diagnostics.activeRequests !== 0
      )
    ) {
      await delay(50)
      diagnostics = await window.m0.diagnostics()
    }

    check(diagnostics.responseCancels === 1, `response cancel count was ${diagnostics.responseCancels}`)
    pass('response.cancel.invokedOnce', { responseCancels: diagnostics.responseCancels })

    const chunksAtAbort = diagnostics.cancelStreamChunks
    await delay(100)
    const settled = await window.m0.diagnostics()
    check(settled.requestSignalAborts >= 1, 'incoming protocol Request.signal did not abort')
    check(settled.upstreamCloses === 1, `upstream close count was ${settled.upstreamCloses}`)
    check(settled.activeRequests === 0, `active proxy requests remained ${settled.activeRequests}`)
    check(settled.cancelStreamChunks === chunksAtAbort, 'upstream produced chunks after cancellation grace period')
    pass('response.cancel.reachesUpstream', {
      requestSignalAborts: settled.requestSignalAborts,
      upstreamCloses: settled.upstreamCloses,
      activeRequests: settled.activeRequests,
      stableChunks: settled.cancelStreamChunks,
    })
  }
  catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error))
    fail('response.cancel.invokedOnce', failure)
    fail('response.cancel.reachesUpstream', failure)
  }
}

async function runRequestStreamingAssertion() {
  await capture('request.streaming.multiChunk', async () => {
    let chunkIndex = 0
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (chunkIndex > 0) { await delay(275) }
        if (chunkIndex === 3) {
          controller.close()
          return
        }
        controller.enqueue(new Uint8Array(BINARY_CHUNK_BYTES).fill(chunkIndex + 1))
        chunkIndex += 1
      },
    })
    const init: RequestInit & { duplex: 'half' } = { method: 'POST', body, duplex: 'half' }
    const response = await fetch(`${CUSTOM_BASE}/request-stream`, init)
    const result = await response.json() as { bytes: number, chunks: number, firstToLastMs: number }
    check(result.bytes === 3 * BINARY_CHUNK_BYTES, `streamed upload length was ${result.bytes}`)
    check(result.chunks >= 2, `upstream observed only ${result.chunks} chunks`)
    check(result.firstToLastMs >= 250, `upstream arrival interval was ${result.firstToLastMs}ms`)
    return {
      bytes: result.bytes,
      upstreamChunks: result.chunks,
      firstToLastMs: Math.round(result.firstToLastMs),
    }
  })
}

async function runMultipartAssertion() {
  await capture('multipart.contentTypeAndBytes', async () => {
    const form = new FormData()
    form.set('field', 'm0-utf8-雪')
    form.set('file', new Blob([new Uint8Array([0, 255, 17, 34, 51, 68])], {
      type: 'application/octet-stream',
    }), 'm0-binary.bin')
    const response = await fetch(`${CUSTOM_BASE}/multipart`, { method: 'POST', body: form })
    const result = await response.json() as {
      hasBoundary: boolean
      hasField: boolean
      hasFilename: boolean
      hasBinarySentinel: boolean
      contentType: string
      bytes: number
    }
    check(result.hasBoundary, `multipart content type lacked a boundary: ${result.contentType}`)
    check(result.hasField && result.hasFilename && result.hasBinarySentinel, 'multipart bytes changed in transit')
    return { bytes: result.bytes, contentType: result.contentType }
  })
}

interface BinaryTransferResult {
  bytes: number
  checksum: number
  expectedChecksum: number
  trace: M0MemoryTrace
}

async function consumeBinary(bytes: number, label: '64MiB' | '128MiB'): Promise<BinaryTransferResult> {
  await window.m0.startMemoryTrace(label)
  let trace = emptyTrace()
  try {
    const response = await fetch(`${CUSTOM_BASE}/binary?bytes=${bytes}`)
    check(response.body !== null, 'binary response had no body')
    const reader = response.body.getReader()
    let received = 0
    let checksum = 0
    while (true) {
      const next = await reader.read()
      if (next.done) { break }
      received += next.value.byteLength
      for (const byte of next.value) { checksum = (checksum + byte) >>> 0 }
    }
    trace = await window.m0.stopMemoryTrace()
    const chunkSum = 33_423_360
    const expectedChecksum = (chunkSum * (bytes / BINARY_CHUNK_BYTES)) >>> 0
    return { bytes: received, checksum, expectedChecksum, trace }
  }
  catch (error) {
    trace = await window.m0.stopMemoryTrace().catch(() => emptyTrace())
    throw error
  }
}

async function runBinaryAssertions() {
  let transfer64: BinaryTransferResult | undefined
  try {
    transfer64 = await consumeBinary(64 * MIB, '64MiB')
    trace64MiB = transfer64.trace
    check(transfer64.bytes === 64 * MIB, `64 MiB byte count was ${transfer64.bytes}`)
    check(transfer64.checksum === transfer64.expectedChecksum, '64 MiB rolling digest changed')
    pass('binary.64MiB.digestAndLength', {
      bytes: transfer64.bytes,
      rollingDigest: transfer64.checksum,
    })

    const mainDelta = transfer64.trace.peakKiB.main - transfer64.trace.baselineKiB.main
    const rendererDelta = transfer64.trace.peakKiB.renderer - transfer64.trace.baselineKiB.renderer
    const numericGate = window.m0.platform !== 'darwin'
    check(transfer64.trace.baselineKiB.renderer > 0, 'renderer working-set metric was unavailable')
    check(!numericGate || mainDelta < 48 * 1024, `Main 64 MiB RSS delta was ${mainDelta} KiB`)
    check(!numericGate || rendererDelta < 48 * 1024, `renderer 64 MiB RSS delta was ${rendererDelta} KiB`)
    pass('binary.64MiB.mainRssBound', { deltaKiB: mainDelta, gateApplied: numericGate })
    pass('binary.64MiB.rendererRssBound', { deltaKiB: rendererDelta, gateApplied: numericGate })
  }
  catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error))
    fail('binary.64MiB.digestAndLength', failure)
    fail('binary.64MiB.mainRssBound', failure)
    fail('binary.64MiB.rendererRssBound', failure)
  }

  try {
    const transfer128 = await consumeBinary(128 * MIB, '128MiB')
    trace128MiB = transfer128.trace
    check(transfer128.bytes === 128 * MIB, `128 MiB byte count was ${transfer128.bytes}`)
    check(transfer128.checksum === transfer128.expectedChecksum, '128 MiB rolling digest changed')
    check(transfer64 !== undefined, '64 MiB baseline was unavailable')
    const main64Delta = transfer64.trace.peakKiB.main - transfer64.trace.baselineKiB.main
    const renderer64Delta = transfer64.trace.peakKiB.renderer - transfer64.trace.baselineKiB.renderer
    const main128Delta = transfer128.trace.peakKiB.main - transfer128.trace.baselineKiB.main
    const renderer128Delta = transfer128.trace.peakKiB.renderer - transfer128.trace.baselineKiB.renderer
    const numericGate = window.m0.platform !== 'darwin'
    check(transfer128.trace.baselineKiB.renderer > 0, 'renderer canary working-set metric was unavailable')
    check(!numericGate || main128Delta <= main64Delta + 16 * 1024, 'Main RSS grew linearly in 128 MiB canary')
    check(!numericGate || renderer128Delta <= renderer64Delta + 16 * 1024, 'renderer RSS grew linearly in 128 MiB canary')
    pass('binary.128MiB.nonLinearMainRss', {
      bytes: transfer128.bytes,
      delta64KiB: main64Delta,
      delta128KiB: main128Delta,
      gateApplied: numericGate,
    })
    pass('binary.128MiB.nonLinearRendererRss', {
      rollingDigest: transfer128.checksum,
      delta64KiB: renderer64Delta,
      delta128KiB: renderer128Delta,
      gateApplied: numericGate,
    })
  }
  catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error))
    fail('binary.128MiB.nonLinearMainRss', failure)
    fail('binary.128MiB.nonLinearRendererRss', failure)
  }
}

async function runSubresourceAssertions() {
  await capture('subresource.image.loads', async () => {
    const image = new Image()
    const loaded = new Promise<void>((resolve, reject) => {
      image.addEventListener('load', () => resolve(), { once: true })
      image.addEventListener('error', () => reject(new Error('custom-scheme image failed to load')), { once: true })
    })
    image.src = `${CUSTOM_BASE}/pixel.png`
    await loaded
    check(image.naturalWidth > 0 && image.naturalHeight > 0, 'image dimensions were zero')
    const diagnostics = await window.m0.diagnostics()
    check(diagnostics.pixelHits === 1, `pixel route hit count was ${diagnostics.pixelHits}`)
    return { width: image.naturalWidth, height: image.naturalHeight, routeHits: diagnostics.pixelHits }
  })

  await capture('subresource.pdf.arrayBufferReadable', async () => {
    const response = await fetch(`${CUSTOM_BASE}/one-page.pdf`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    const signature = new TextDecoder().decode(bytes.subarray(0, 5))
    const sha256 = await sha256Hex(bytes)
    check(response.headers.get('content-type') === 'application/pdf', 'PDF content type changed')
    check(signature === '%PDF-', `PDF signature was ${signature}`)
    check(Number(response.headers.get('content-length')) === bytes.length, 'PDF length changed')
    check(response.headers.get('x-m0-sha256') === sha256, 'PDF digest changed')
    return { bytes: bytes.length, signature, sha256 }
  })

  await capture('subresource.dynamicModule.simple', async () => {
    const simple = await import(/* @vite-ignore */ `${CUSTOM_BASE}/simple.mjs`) as { default: number, value: number }
    check(simple.default === 42 && simple.value === 42, 'simple custom-scheme module exports changed')
    return { defaultExport: simple.default, namedExport: simple.value }
  })

  try {
    const registry = {
      'react': React,
      'react-dom': ReactDom,
      'react/jsx-runtime': ReactJsxRuntime,
      'react/jsx-dev-runtime': ReactJsxDevRuntime,
      'react-dom/client': ReactDomClient,
    }
    Reflect.set(window, Symbol.for('cradle:modules'), registry)

    interface RealPluginModule {
      activate: (context: object) => void
    }
    const plugin = await import(/* @vite-ignore */ `${CUSTOM_BASE}/api/plugins/system-info/web.mjs`) as RealPluginModule
    check(typeof plugin.activate === 'function', 'real system-info bundle did not export activate')
    let panels = 0
    let commands = 0
    let logs = 0
    plugin.activate({
      panels: { register: () => { panels += 1 } },
      commands: { register: () => { commands += 1 } },
      logger: { info: () => { logs += 1 } },
      routes: { fetch: () => Promise.reject(new Error('route execution is outside M0')) },
      storage: { get: () => undefined, set: () => undefined, delete: () => undefined },
    })
    check(panels === 1 && commands === 1 && logs >= 1, 'real plugin activation did not register expected contributions')
    pass('subresource.dynamicModule.realPlugin', { panels, commands, logs })

    const diagnostics = await window.m0.diagnostics()
    check(diagnostics.realPluginHits === 1, `real plugin route hit count was ${diagnostics.realPluginHits}`)
    check(diagnostics.dependencyHits >= 1, 'real plugin did not request custom-scheme dependency wrappers')
    check(
      diagnostics.customSchemeModuleHits === diagnostics.simpleModuleHits + diagnostics.realPluginHits + diagnostics.dependencyHits,
      'a module request bypassed the custom-scheme handler',
    )
    pass('subresource.dynamicModule.dependenciesStayCustomScheme', {
      dependencyHits: diagnostics.dependencyHits,
      customSchemeModuleHits: diagnostics.customSchemeModuleHits,
    })
  }
  catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error))
    fail('subresource.dynamicModule.realPlugin', failure)
    fail('subresource.dynamicModule.dependenciesStayCustomScheme', failure)
  }
}

async function runSecurityAssertions() {
  await capture('security.strictRepresentativeCsp', async () => {
    const meta = document.querySelector<HTMLMetaElement>('meta[http-equiv="Content-Security-Policy"]')
    check(meta !== null, 'fixture CSP meta element was missing')
    const policy = meta.content
    check(policy.includes('default-src \'none\''), 'fixture CSP did not deny by default')
    check(policy.includes('script-src \'self\' cradle-server:'), 'fixture CSP did not allow only self/custom scripts')
    check(policy.includes('connect-src cradle-server:'), 'fixture CSP did not constrain connections')
    check(!policy.includes('http:') && !policy.includes('https:'), 'fixture CSP allowed HTTP(S)')
    return { policy, representativePolicy: true, productCspPresent: false }
  })
}

async function run() {
  await runSecurityAssertions()
  await runBasicFetchAssertions()
  await runResponseStreamingAssertion()
  await runCancellationAssertions()
  await runRequestStreamingAssertion()
  await runMultipartAssertion()
  await runBinaryAssertions()
  await runSubresourceAssertions()

  const report: M0RendererReport = { assertions, trace64MiB, trace128MiB }
  document.querySelector('#status')!.textContent = 'M0 renderer assertions complete.'
  window.m0.complete(report)
}

void run().catch((error) => {
  const failure = error instanceof Error ? error : new Error(String(error))
  document.querySelector('#status')!.textContent = errorMessage(failure)
  for (const name of [
    'fetch.get.queryAndHeaders',
    'fetch.post.binaryBody',
    'fetch.non2xx.responseParity',
  ] as const) {
    if (!assertions[name]) { fail(name, failure) }
  }
  window.m0.complete({ assertions, trace64MiB, trace128MiB })
})
