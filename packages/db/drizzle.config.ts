import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    // Relative to packages/db (drizzle-kit resolves from the process cwd,
    // and all drizzle-kit scripts run from this package).
    url: process.env.DB_URL || 'file:../../apps/server/data/cradle.db',
  },
})
