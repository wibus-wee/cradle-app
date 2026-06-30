import { resourceFromAttributes } from '@opentelemetry/resources'
import {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_NAMESPACE,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions'

import packageJson from '../../package.json'
import type { TelemetryConfig } from './config'

export function createTelemetryResource(config: TelemetryConfig) {
  return resourceFromAttributes({
    [ATTR_SERVICE_NAME]: config.serviceName,
    [ATTR_SERVICE_NAMESPACE]: 'cradle',
    [ATTR_SERVICE_VERSION]: packageJson.version,
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: config.environment,
    'process.pid': process.pid,
    'process.runtime.name': 'node',
    'process.runtime.version': process.version,
    'cradle.component': 'server',
  })
}
