export const M0_NO_SANDBOX_ENV: 'CRADLE_M0_NO_SANDBOX'

export interface M0LaunchPolicy {
  noSandbox: boolean
  developmentArgs: string[]
  packagedArgs: string[]
}

export function resolveM0LaunchPolicy(options?: {
  platform?: NodeJS.Platform
  githubActions?: string
  noSandboxRequest?: string
}): M0LaunchPolicy
