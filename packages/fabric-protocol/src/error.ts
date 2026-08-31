export class FabricProtocolError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'FabricProtocolError'
    this.code = code
  }
}

export function invalidFabricFrame(message: string): FabricProtocolError {
  return new FabricProtocolError('fabric_protocol_invalid_frame', message)
}
