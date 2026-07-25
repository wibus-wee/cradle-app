import { serve } from 'srvx'

export async function startListener(fetch: (request: Request) => Response | Promise<Response>, port: number) {
  const server = serve({
    fetch,
    hostname: '127.0.0.1',
    port,
    gracefulShutdown: false,
    silent: true,
  })
  await server.ready()
  return server
}
