import { z } from 'zod'

const DEFAULT_GITHUB_APP_CLIENT_ID = 'Iv23liafSutKq8Ldqkog'
const DEFAULT_GITHUB_APP_SLUG = 'cradleapp'

const optionalEnvString = z.string()
  .trim()
  .transform(value => value.length > 0 ? value : undefined)
  .optional()

const githubAppEnvSchema = z.object({
  CRADLE_GITHUB_APP_CLIENT_ID: optionalEnvString,
  CRADLE_GITHUB_APP_SLUG: optionalEnvString,
}).transform(env => ({
  clientId: env.CRADLE_GITHUB_APP_CLIENT_ID ?? DEFAULT_GITHUB_APP_CLIENT_ID,
  slug: env.CRADLE_GITHUB_APP_SLUG ?? DEFAULT_GITHUB_APP_SLUG,
  name: 'Cradle',
}))

export interface GitHubAppConfig {
  clientId: string | null
  slug: string | null
  name: string
}

export function loadGitHubAppConfig(env: NodeJS.ProcessEnv = process.env): GitHubAppConfig {
  return githubAppEnvSchema.parse(env)
}
