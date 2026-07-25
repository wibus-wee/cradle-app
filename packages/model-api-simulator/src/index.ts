import type { ModelApiSimulator, StartSimulatorOptions } from './contract'
import { ScenarioController } from './core/scenario-runtime'
import { startListener } from './listener'
import { createSimulatorApp } from './server'

export * from './anthropic'
export * from './contract'
export * from './core/scenario-runtime'
export * from './openai'

export async function startModelApiSimulator(
  options: StartSimulatorOptions = {},
): Promise<ModelApiSimulator> {
  const controller = new ScenarioController()
  const app = createSimulatorApp(controller)
  const server = await startListener(app.fetch, options.port ?? 0)
  if (!server.url) { throw new Error('srvx did not expose a URL after ready()') }
  const url = new URL(server.url)
  const origin = url.origin
  let closed = false

  return {
    anthropicBaseUrl: origin,
    openaiBaseUrl: `${origin}/v1`,
    controller,
    async close(): Promise<void> {
      if (closed) { return }
      closed = true
      controller.close()
      await server.close(true)
    },
  }
}
