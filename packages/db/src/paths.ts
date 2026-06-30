import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export function getMigrationsPath(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url))
  const packageMigrations = join(currentDir, '..', 'drizzle')

  if (existsSync(join(packageMigrations, 'meta', '_journal.json'))) {
    return packageMigrations
  }

  return join(currentDir, '..', '..', '..', 'drizzle')
}
