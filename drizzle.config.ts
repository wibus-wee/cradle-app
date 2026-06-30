import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './packages/db/src/schema/index.ts',
  out: './packages/db/drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.DB_URL || 'file:./apps/server/data/cradle.db',
  },
})
