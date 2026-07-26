import type { IncomingMessage, ServerResponse } from 'node:http'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import type { RequestMatch, SimulatorScenario } from '@cradle/model-api-simulator'
import {
  startModelApiSimulator,
} from '@cradle/model-api-simulator'
import type { TestProject } from 'vitest/node'

declare module 'vitest' {
  export interface ProvidedContext {
    cradleAnthropicSimulatorBaseUrl: string
    cradleAnthropicSimulatorControlUrl: string
  }
}

interface SimulatorControlBody {
  scenario?: SimulatorScenario
  match?: RequestMatch
  gate?: string
}

export async function setup(project: TestProject): Promise<() => Promise<void>> {
  const simulator = await startModelApiSimulator({ port: 0 })
  const control = await startSimulatorControlServer(simulator.controller)

  // Global setup and test workers cannot share the controller object, so provide loopback URLs only.
  project.provide('cradleAnthropicSimulatorBaseUrl', simulator.anthropicBaseUrl)
  project.provide('cradleAnthropicSimulatorControlUrl', control.url)

  return async () => {
    await control.close()
    await simulator.close()
  }
}

async function startSimulatorControlServer(
  controller: Awaited<ReturnType<typeof startModelApiSimulator>>['controller'],
): Promise<{ url: string, close: () => Promise<void> }> {
  const server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
      const body = request.method === 'POST'
        ? JSON.parse(await readRequestBody(request)) as SimulatorControlBody
        : {}

      switch (`${request.method} ${path}`) {
        case 'GET /requests':
          sendJson(response, 200, controller.requests())
          return
        case 'POST /enqueue':
          controller.enqueue(body.scenario!)
          sendJson(response, 204, null)
          return
        case 'POST /reset':
          controller.reset()
          sendJson(response, 204, null)
          return
        case 'POST /wait-for-request':
          sendJson(response, 200, await controller.waitForRequest(body.match!))
          return
        case 'POST /wait-for-gate':
          await controller.waitForGate(body.gate!)
          sendJson(response, 204, null)
          return
        case 'POST /release':
          controller.release(body.gate!)
          sendJson(response, 204, null)
          return
        case 'POST /assert-exhausted':
          controller.assertExhausted()
          sendJson(response, 204, null)
          return
        default:
          sendJson(response, 404, { error: 'unknown simulator control route' })
      }
    }
    catch (error) {
      sendJson(response, 409, {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve())
        server.closeAllConnections()
      })
    },
  }
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8') || '{}'
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(body === null ? '' : JSON.stringify(body))
}
