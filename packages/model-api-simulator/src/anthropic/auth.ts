export function authenticateAnthropic(request: Request): Response | undefined {
  const hasKey
    = Boolean(request.headers.get('x-api-key'))
      || request.headers.get('authorization')?.startsWith('Bearer ') === true
  if (!hasKey) { return anthropicAuthError('authentication_error', 'Missing API key', 401) }
  if (!request.headers.get('anthropic-version')) { return anthropicAuthError('invalid_request_error', 'Missing anthropic-version header', 400) }
  return undefined
}

function anthropicAuthError(type: string, message: string, status: number): Response {
  return Response.json(
    { type: 'error', error: { type, message } },
    { status, headers: { 'request-id': 'req_simulator_auth' } },
  )
}
