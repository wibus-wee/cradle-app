import type { StreamStep } from '../contract'
import type { ScenarioController } from './scenario-runtime'
import { SimulatorScenarioError } from './scenario-runtime'

const schedulerYield = (): Promise<void> =>
  new Promise((resolve) => {
    setImmediate(resolve)
  })

export function createScheduledStream(
  controller: ScenarioController,
  steps: readonly StreamStep[],
  encodeEvent: (event: StreamStep & { kind: 'event' }) => Uint8Array,
): ReadableStream<Uint8Array> {
  let cancelled = false
  let unregister: (() => void) | undefined
  let index = 0
  return new ReadableStream<Uint8Array>({
    start(stream) {
      unregister = controller.trackStream((reason) => {
        cancelled = true
        stream.error(reason)
      })
    },
    async pull(stream) {
      try {
        for (;;) {
          if (cancelled) {
            return
          }
          const step = steps[index]
          if (!step) {
            unregister?.()
            stream.close()
            return
          }
          index += 1
          switch (step.kind) {
            case 'event':
              stream.enqueue(encodeEvent(step))
              return
            case 'gate':
              await controller.waitAtGate(step.name)
              break
            case 'yield':
              await schedulerYield()
              return
            case 'close':
              unregister?.()
              stream.close()
              return
            case 'disconnect':
              unregister?.()
              stream.error(new SimulatorScenarioError(`Disconnected: ${step.reason}`))
              return
          }
        }
      }
 catch (error) {
        unregister?.()
        stream.error(error)
      }
    },
    cancel() {
      cancelled = true
      unregister?.()
    },
  })
}
