import type { Command } from 'commander'

import { register as registerRelayTransportHostEnrollmentCreate } from '../relay-transport/host-enrollment/create'
import { register as registerRelayTransportHostEnrollmentDelete } from '../relay-transport/host-enrollment/delete'
import { register as registerRelayTransportHostEnrollmentGet } from '../relay-transport/host-enrollment/get'
import { register as registerRelayTransportHostEnrollmentList } from '../relay-transport/host-enrollment/list'
import { register as registerRelayTransportHostEnrollmentPairingString } from '../relay-transport/host-enrollment/pairing-string'

export function registerGeneratedCommands(program: Command): void {
  registerRelayTransportHostEnrollmentCreate(program)
  registerRelayTransportHostEnrollmentDelete(program)
  registerRelayTransportHostEnrollmentGet(program)
  registerRelayTransportHostEnrollmentList(program)
  registerRelayTransportHostEnrollmentPairingString(program)
}
