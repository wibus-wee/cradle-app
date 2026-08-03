/**
 * Compile-time parity between `@cradle/chat-runtime-contracts` RuntimeUiSlotState
 * and the TypeBox schemas in `ui-slot-schemas.ts`. If either side drifts, typecheck
 * / this suite fails.
 */

import type { RuntimeUiSlotState } from '@cradle/chat-runtime-contracts'
import type { Static } from 'elysia'
import { describe, expectTypeOf, it } from 'vitest'

import type { runtimeUiSlotStateSchema } from './ui-slot-schemas'

type SchemaRuntimeUiSlotState = Static<typeof runtimeUiSlotStateSchema>

describe('runtimeUiSlotState contract ↔ TypeBox parity', () => {
  it('keeps contract and schema shapes mutually assignable', () => {
    expectTypeOf<RuntimeUiSlotState>().toMatchTypeOf<SchemaRuntimeUiSlotState>()
    expectTypeOf<SchemaRuntimeUiSlotState>().toMatchTypeOf<RuntimeUiSlotState>()
  })
})
