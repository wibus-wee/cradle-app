/**
 * Observability enum/input parity between:
 * - `@cradle/chat-runtime-contracts` RuntimeObservability*
 * - `@cradle/ipc` Observability*
 * - server `CreateEventInput`
 *
 * Full unification is blocked by package deps (ipc peers Electron; contracts
 * depend on `ai`). Keep the mirrored unions/fields in lockstep via this suite.
 */

import type {
  RuntimeObservabilityCategory,
  RuntimeObservabilityEventInput,
  RuntimeObservabilitySeverity,
  RuntimeObservabilitySource,
} from '@cradle/chat-runtime-contracts'
import type {
  ObservabilityCategory,
  ObservabilitySeverity,
  ObservabilitySource,
} from '@cradle/ipc'
import { describe, expectTypeOf, it } from 'vitest'

import type { CreateEventInput } from '../observability/contract'

describe('observability type parity', () => {
  it('keeps severity/category/source unions identical across contracts and ipc', () => {
    expectTypeOf<RuntimeObservabilitySeverity>().toEqualTypeOf<ObservabilitySeverity>()
    expectTypeOf<RuntimeObservabilityCategory>().toEqualTypeOf<ObservabilityCategory>()
    expectTypeOf<RuntimeObservabilitySource>().toEqualTypeOf<ObservabilitySource>()
  })

  it('keeps CreateEventInput aligned with RuntimeObservabilityEventInput', () => {
    expectTypeOf<CreateEventInput>().toEqualTypeOf<RuntimeObservabilityEventInput>()
  })
})
