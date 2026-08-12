export const M0_NO_SANDBOX_ENV = 'CRADLE_M0_NO_SANDBOX'

export function resolveM0LaunchPolicy({
  platform = process.platform,
  githubActions = process.env.GITHUB_ACTIONS,
  noSandboxRequest = process.env[M0_NO_SANDBOX_ENV],
} = {}) {
  if (noSandboxRequest !== undefined && noSandboxRequest !== '' && noSandboxRequest !== '1') {
    throw new Error(`${M0_NO_SANDBOX_ENV} must be unset or 1`)
  }

  const noSandbox = noSandboxRequest === '1'
  if (noSandbox && (platform !== 'linux' || githubActions !== 'true')) {
    throw new Error(`${M0_NO_SANDBOX_ENV}=1 is allowed only on Linux GitHub Actions runners`)
  }

  return {
    noSandbox,
    developmentArgs: noSandbox ? ['--noSandbox'] : [],
    packagedArgs: noSandbox ? ['--no-sandbox'] : [],
  }
}
