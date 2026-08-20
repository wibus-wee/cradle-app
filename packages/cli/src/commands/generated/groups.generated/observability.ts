import type { Command } from 'commander'

import { register as registerObservabilityErrorPatterns } from '../observability/error-patterns'
import { register as registerObservabilityEvents } from '../observability/events'
import { register as registerObservabilityExport } from '../observability/export'
import { register as registerObservabilityIncidents } from '../observability/incidents'
import { register as registerObservabilityRuntimeSnapshot } from '../observability/runtime-snapshot'

export function registerGeneratedCommands(program: Command): void {
  registerObservabilityErrorPatterns(program)
  registerObservabilityEvents(program)
  registerObservabilityExport(program)
  registerObservabilityIncidents(program)
  registerObservabilityRuntimeSnapshot(program)
}
