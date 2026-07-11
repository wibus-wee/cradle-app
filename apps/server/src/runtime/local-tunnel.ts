import net from 'node:net'

export interface LocalTunnelHandle {
  readonly hostId: string
  readonly localPort: number
  readonly localBaseUrl: string
  readonly pid: number | null
  readonly stderr: string
  onExit: (listener: (exit: { code: number | null, signal: NodeJS.Signals | null }) => void) => void
  close: () => Promise<void>
}

export async function allocateLocalPort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        if (!address || typeof address === 'string') {
          reject(new Error('Failed to allocate a local TCP port.'))
          return
        }
        resolve(address.port)
      })
    })
  })
}
