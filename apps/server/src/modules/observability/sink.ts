import type { CreateEventInput } from './contract'

export interface ObservabilitySink {
  record: (input: CreateEventInput) => void
}

export const noopObservabilitySink: ObservabilitySink = {
  record: () => {},
}
