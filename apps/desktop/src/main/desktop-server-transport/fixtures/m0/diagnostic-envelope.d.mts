export interface FileDiagnostic {
  path: string
  exists: boolean
  kind?: 'file' | 'directory' | 'other'
  size?: number
  mode?: number
  modifiedAt?: string
  sha256?: string
}

export function redactDiagnosticText(value: unknown): string
export function serializeDiagnosticError(error: unknown): {
  name: string
  message: string
  code: string | null
}
export function fileDiagnostic(path: string, options?: { hash?: boolean }): Promise<FileDiagnostic>
export function writeDiagnosticEnvelope(path: string, envelope: object): Promise<void>
