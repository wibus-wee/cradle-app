import type { AuthMethod } from '@agentclientprotocol/sdk'

import type { ProviderAuthMethod } from '../../chat-runtime/runtime-provider-types'

const TERMINAL_AUTH_UNAVAILABLE_REASON
  = 'Cradle does not host interactive ACP terminal authentication.'
const REMOTE_ENV_AUTH_UNAVAILABLE_REASON
  = 'Environment-variable authentication requires a local ACP process.'

export function projectAcpAuthMethods(
  methods: readonly AuthMethod[],
  options: { supportsEnvironmentAuth?: boolean } = {},
): ProviderAuthMethod[] {
  return methods.map((method) => {
    const description = method.description ?? undefined

    if ('type' in method && method.type === 'env_var') {
      return {
        id: method.id,
        name: method.name,
        ...(description ? { description } : {}),
        kind: 'env_var',
        status: options.supportsEnvironmentAuth === false ? 'unsupported' : 'supported',
        ...(options.supportsEnvironmentAuth === false
          ? { unavailableReason: REMOTE_ENV_AUTH_UNAVAILABLE_REASON }
          : {}),
        ...(method.link ? { link: method.link } : {}),
        fields: method.vars.map(variable => ({
          name: variable.name,
          ...(variable.label ? { label: variable.label } : {}),
          secret: variable.secret ?? true,
          optional: variable.optional ?? false,
        })),
      }
    }

    if ('type' in method && method.type === 'terminal') {
      return {
        id: method.id,
        name: method.name,
        ...(description ? { description } : {}),
        kind: 'terminal',
        status: 'unsupported',
        unavailableReason: TERMINAL_AUTH_UNAVAILABLE_REASON,
      }
    }

    return {
      id: method.id,
      name: method.name,
      ...(description ? { description } : {}),
      kind: 'agent',
      status: 'supported',
    }
  })
}
