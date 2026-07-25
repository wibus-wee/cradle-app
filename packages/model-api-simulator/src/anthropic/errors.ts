export function anthropicError(error: Error, status = 400): Response {
  return Response.json(
    {
      type: 'error',
      error: { type: 'invalid_request_error', message: error.message },
    },
    { status, headers: { 'request-id': 'req_simulator_error' } },
  )
}
