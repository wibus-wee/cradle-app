import { describe, expect, it, vi } from 'vitest'

import { createServices, IpcMethod, IpcService } from './base'

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}))

class TestService extends IpcService {
  static readonly groupName = 'test'

  constructor(private readonly value: string) {
    super()
  }

  ping() {
    return this.value
  }
}

const SymbolMetadata = Symbol.metadata ?? Symbol.for('Symbol.metadata')
const testServiceMetadata = {}

IpcMethod()(TestService.prototype.ping, {
  kind: 'method',
  name: 'ping',
  static: false,
  private: false,
  metadata: testServiceMetadata,
  access: {
    has: object => 'ping' in object,
    get: object => object.ping,
  },
  addInitializer() {},
} satisfies ClassMethodDecoratorContext<TestService, TestService['ping']>)

Object.defineProperty(TestService, SymbolMetadata, { value: testServiceMetadata })

describe('createServices', () => {
  it('accepts pre-built service instances for explicit dependency injection', () => {
    const service = new TestService('injected-value')

    const services = createServices([service] as const)

    expect(services.test).toBe(service)
    expect((services.test as TestService).ping()).toBe('injected-value')
  })
})
