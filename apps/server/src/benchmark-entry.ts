import { shutdownInfra } from './infra'

export { createServerApp } from './app'
export {
  fetchModelsDevData,
  warmupModelsDevCache,
} from './modules/model-registry/model-info-registry'

/** Close the database for the listener-free in-process benchmark harness. */
export function shutdownBenchmarkRuntime(): void {
  shutdownInfra()
}
