import type { ModelApiSimulator, StartSimulatorOptions } from './contract'
import { startListener } from './listener'
import { createSimulatorApp, createSimulatorRuntime } from './server'

export * from './anthropic'
export * from './contract'
export * from './conversation-load-pattern'
export * from './core/auto-respond-policy'
export * from './core/scenario-runtime'
export * from './openai'

export async function startModelApiSimulator(
  options: StartSimulatorOptions = {},
): Promise<ModelApiSimulator> {
  const runtime = createSimulatorRuntime()
  const app = createSimulatorApp(runtime, {
    ...(options.strictRequestValidation === undefined ? {} : { strictRequestValidation: options.strictRequestValidation }),
    ...(options.autoRespond === undefined ? {} : { autoRespond: options.autoRespond }),
  })
  const server = await startListener(app.fetch, options.port ?? 0)
  if (!server.url) { throw new Error('srvx did not expose a URL after ready()') }
  const url = new URL(server.url)
  const origin = url.origin
  let closed = false

  return {
    anthropicBaseUrl: origin,
    openaiBaseUrl: `${origin}/v1`,
    controller: runtime.controller,
    async close(): Promise<void> {
      if (closed) { return }
      closed = true
      runtime.controller.close()
      await server.close(true)
    },
  }
}
