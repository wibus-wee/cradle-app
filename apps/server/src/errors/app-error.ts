export class AppError extends Error {
  readonly code: string
  readonly status: number
  readonly details?: Record<string, unknown>

  constructor(options: {
    code: string
    status: number
    message: string
    details?: Record<string, unknown>
  }) {
    super(options.message)
    this.code = options.code
    this.status = options.status
    this.details = options.details
  }
}
