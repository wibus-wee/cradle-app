export function authenticateOpenAi(request: Request): Response | undefined {
  if (request.headers.get('authorization')?.startsWith('Bearer ') !== true) {
 return Response.json(
      {
        error: {
          message: 'Missing Bearer API key',
          type: 'invalid_request_error',
          param: null,
          code: 'invalid_api_key',
        },
      },
      { status: 401, headers: { 'x-request-id': 'req_simulator_auth' } },
    )
}
  return undefined
}
