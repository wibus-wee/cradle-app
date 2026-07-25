import coverage from '../generated/protocol-coverage.json'

export function assertCoreProtocolCovered(): void {
  const uncovered = [...coverage.schemaBranches.uncovered, ...coverage.transitions.uncovered]
  if (uncovered.length > 0) { throw new Error(`Uncovered core protocol IDs: ${uncovered.join(', ')}`) }
}
