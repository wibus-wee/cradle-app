import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createServer } from 'node:http'
import { join } from 'node:path'

const BINARY_CHUNK_BYTES = 256 * 1024
const BINARY_CHUNK = Buffer.allocUnsafe(BINARY_CHUNK_BYTES)
for (let index = 0; index < BINARY_CHUNK.length; index += 1) {
  BINARY_CHUNK[index] = index % 256
}

const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

const ONE_PAGE_PDF = Buffer.from(
  '%PDF-1.4\n'
  + '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n'
  + '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n'
  + '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R/Resources<<>>>>endobj\n'
  + '4 0 obj<</Length 0>>stream\nendstream\nendobj\n'
  + 'xref\n0 5\n0000000000 65535 f \n'
  + '0000000009 00000 n \n0000000052 00000 n \n0000000101 00000 n \n0000000193 00000 n \n'
  + 'trailer<</Size 5/Root 1 0 R>>\nstartxref\n237\n%%EOF\n',
  'ascii',
)

export interface FakeUpstreamDiagnostics {
  activeRequests: number
  upstreamCloses: number
  cancelStreamChunks: number
  requestStreamChunks: number
  requestStreamFirstToLastMs: number
  pixelHits: number
  simpleModuleHits: number
  realPluginHits: number
  dependencyHits: number
  pdfBytes: number
  pdfSha256: string
}

export interface FakeUpstream {
  origin: string
  diagnostics: FakeUpstreamDiagnostics
  close: () => Promise<void>
}

function sendJson(response: ServerResponse, value: object, status = 200, headers: Record<string, string> = {}) {
  response.writeHead(status, { 'content-type': 'application/json', ...headers })
  response.end(JSON.stringify(value))
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

async function streamBinary(response: ServerResponse, byteCount: number) {
  let remaining = byteCount
  while (remaining > 0 && !response.destroyed) {
    const length = Math.min(BINARY_CHUNK_BYTES, remaining)
    const canContinue = response.write(length === BINARY_CHUNK_BYTES ? BINARY_CHUNK : BINARY_CHUNK.subarray(0, length))
    remaining -= length
    if (!canContinue) {
      await new Promise<void>(resolve => response.once('drain', resolve))
    }
  }
  response.end()
}

export async function startFakeUpstream(resourceRoot: string): Promise<FakeUpstream> {
  const diagnostics: FakeUpstreamDiagnostics = {
    activeRequests: 0,
    upstreamCloses: 0,
    cancelStreamChunks: 0,
    requestStreamChunks: 0,
    requestStreamFirstToLastMs: 0,
    pixelHits: 0,
    simpleModuleHits: 0,
    realPluginHits: 0,
    dependencyHits: 0,
    pdfBytes: ONE_PAGE_PDF.length,
    pdfSha256: createHash('sha256').update(ONE_PAGE_PDF).digest('hex'),
  }

  const server = createServer((request, response) => {
    diagnostics.activeRequests += 1
    let finished = false
    const finish = () => {
      if (finished) { return }
      finished = true
      diagnostics.activeRequests -= 1
    }
    response.once('finish', finish)
    response.once('close', finish)

    void (async () => {
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')

      if (requestUrl.pathname === '/get') {
        sendJson(response, { method: request.method, value: requestUrl.searchParams.get('value') }, 200, {
          'x-m0-upstream': 'get',
        })
        return
      }

      if (requestUrl.pathname === '/post') {
        const body = await readBody(request)
        sendJson(response, {
          length: body.length,
          sha256: createHash('sha256').update(body).digest('hex'),
        })
        return
      }

      if (requestUrl.pathname === '/status') {
        response.writeHead(418, 'M0 Teapot', {
          'content-type': 'text/plain',
          'x-m0-status': 'teapot',
        })
        response.end('m0-status-body')
        return
      }

      if (requestUrl.pathname === '/response-stream') {
        response.writeHead(200, { 'content-type': 'application/octet-stream' })
        response.write(Buffer.from('first-chunk'))
        await new Promise(resolve => setTimeout(resolve, 1_000))
        response.end(Buffer.from('final-chunk'))
        return
      }

      if (requestUrl.pathname === '/cancel-stream') {
        response.writeHead(200, { 'content-type': 'application/octet-stream' })
        let closeCounted = false
        response.once('close', () => {
          if (!closeCounted) {
            closeCounted = true
            diagnostics.upstreamCloses += 1
          }
        })
        const timer = setInterval(() => {
          if (response.destroyed) {
            clearInterval(timer)
            return
          }
          diagnostics.cancelStreamChunks += 1
          response.write(Buffer.alloc(32 * 1024, diagnostics.cancelStreamChunks % 251))
        }, 40)
        response.once('close', () => clearInterval(timer))
        return
      }

      if (requestUrl.pathname === '/request-stream') {
        const timestamps: number[] = []
        let bytes = 0
        for await (const chunk of request) {
          const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          timestamps.push(performance.now())
          diagnostics.requestStreamChunks += 1
          bytes += data.length
        }
        const firstToLastMs = timestamps.length > 1 ? timestamps.at(-1)! - timestamps[0] : 0
        diagnostics.requestStreamFirstToLastMs = firstToLastMs
        sendJson(response, { bytes, chunks: timestamps.length, firstToLastMs })
        return
      }

      if (requestUrl.pathname === '/multipart') {
        const contentType = request.headers['content-type'] ?? ''
        const body = await readBody(request)
        const utf8 = body.toString('utf8')
        const binarySentinel = Buffer.from([0, 255, 17, 34, 51, 68])
        sendJson(response, {
          hasBoundary: /^multipart\/form-data;\s*boundary=/.test(contentType),
          hasField: utf8.includes('m0-utf8-雪'),
          hasFilename: utf8.includes('m0-binary.bin'),
          hasBinarySentinel: body.includes(binarySentinel),
          contentType,
          bytes: body.length,
        })
        return
      }

      if (requestUrl.pathname === '/binary') {
        const byteCount = Number(requestUrl.searchParams.get('bytes'))
        if (!Number.isSafeInteger(byteCount) || byteCount < 0) {
          sendJson(response, { error: 'invalid byte count' }, 400)
          return
        }
        response.writeHead(200, {
          'content-type': 'application/octet-stream',
          'content-length': String(byteCount),
          'x-m0-pattern': 'byte-index-mod-256',
        })
        await streamBinary(response, byteCount)
        return
      }

      if (requestUrl.pathname === '/pixel.png') {
        diagnostics.pixelHits += 1
        response.writeHead(200, { 'content-type': 'image/png', 'content-length': String(PIXEL_PNG.length) })
        response.end(PIXEL_PNG)
        return
      }

      if (requestUrl.pathname === '/one-page.pdf') {
        response.writeHead(200, {
          'content-type': 'application/pdf',
          'content-length': String(ONE_PAGE_PDF.length),
          'x-m0-sha256': diagnostics.pdfSha256,
        })
        response.end(ONE_PAGE_PDF)
        return
      }

      if (requestUrl.pathname === '/simple.mjs') {
        diagnostics.simpleModuleHits += 1
        response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
        response.end('export const value = 42; export default value;\n')
        return
      }

      if (requestUrl.pathname === '/api/plugins/system-info/web.mjs') {
        diagnostics.realPluginHits += 1
        const source = await readFile(join(resourceRoot, 'system-info', 'web.mjs'))
        response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
        response.end(source)
        return
      }

      if (requestUrl.pathname.startsWith('/api/plugins/-/deps/')) {
        diagnostics.dependencyHits += 1
        const fileName = requestUrl.pathname.slice('/api/plugins/-/deps/'.length)
        if (!/^[a-z0-9-]+\.mjs$/.test(fileName)) {
          sendJson(response, { error: 'invalid dependency' }, 400)
          return
        }
        try {
          const source = await readFile(join(resourceRoot, 'deps', fileName))
          response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
          response.end(source)
        }
        catch {
          sendJson(response, { error: 'dependency not found' }, 404)
        }
        return
      }

      if (requestUrl.pathname === '/diagnostics') {
        sendJson(response, diagnostics)
        return
      }

      sendJson(response, { error: 'not found' }, 404)
    })().catch((error: Error) => {
      if (!response.headersSent) { response.writeHead(500, { 'content-type': 'text/plain' }) }
      response.end(error.message)
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') { throw new Error('M0 fake upstream did not bind a TCP port') }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    diagnostics,
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
      server.closeAllConnections()
    }),
  }
}
