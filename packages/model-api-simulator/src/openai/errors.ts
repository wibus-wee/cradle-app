export function openAiError(error: Error, status = 400): Response {
  return Response.json(
    {
      error: {
        message: error.message,
        type: 'invalid_request_error',
        param: null,
        code: null,
      },
    },
    { status, headers: { 'x-request-id': 'req_simulator_error' } },
  )
}
