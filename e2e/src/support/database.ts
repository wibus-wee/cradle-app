/**
 * @deprecated YOU MUST NOT USE THIS FUNCTION TO MUTATE THE DATABASE.
 *
 * In e2e test, we shouldn't use database to ensure test data setup, instead we should use UI to drive the app to the state we want to test.
 */

import type { CradleWorld } from './world'

type SqliteParam = string | number | null
interface ElectronDatabaseContext {
  app: {
    getAppPath: () => string
    getPath: (name: string) => string
  }
}

interface DatabaseQueryInput {
  sql: string
  params: SqliteParam[]
}

/**
 * @deprecated YOU MUST NOT USE THIS FUNCTION TO MUTATE THE DATABASE. In e2e test, we shouldn't use database to ensure test data setup, instead we should use UI to drive the app to the state we want to test.
 */
export async function queryDatabaseRow<T>(
  world: CradleWorld,
  sql: string,
  params: SqliteParam[] = [],
): Promise<T | null> {
  return world.mainProcess<T | null>(
    async (electron: ElectronDatabaseContext, { sql, params }: DatabaseQueryInput) => {
      const getBuiltinModule = process.getBuiltinModule?.bind(process)

      if (!getBuiltinModule) {
        throw new Error('process.getBuiltinModule unavailable in Electron evaluate context')
      }

      const path = getBuiltinModule('node:path')
      const moduleApi = getBuiltinModule('node:module')
      const requireFromApp = moduleApi.createRequire(path.join(electron.app.getAppPath(), 'package.json'))
      const Database = requireFromApp('better-sqlite3')

      if (!Database) {
        throw new Error('better-sqlite3 default export unavailable in Electron main process')
      }

      const dbPath = path.join(electron.app.getPath('userData'), 'cradle.db')
      const db = new Database(dbPath, { readonly: true })

      try {
        return (db.prepare(sql).get(...params) as T | undefined) ?? null
      }
      finally {
        db.close()
      }
    },
    { sql, params },
  )
}

/**
 * @deprecated YOU MUST NOT USE THIS FUNCTION TO MUTATE THE DATABASE. In e2e test, we shouldn't use database to ensure test data setup, instead we should use UI to drive the app to the state we want to test.
 */
export async function queryDatabaseRows<T>(
  world: CradleWorld,
  sql: string,
  params: SqliteParam[] = [],
): Promise<T[]> {
  return world.mainProcess<T[]>(
    async (electron: ElectronDatabaseContext, { sql, params }: DatabaseQueryInput) => {
      const getBuiltinModule = process.getBuiltinModule?.bind(process)

      if (!getBuiltinModule) {
        throw new Error('process.getBuiltinModule unavailable in Electron evaluate context')
      }

      const path = getBuiltinModule('node:path')
      const moduleApi = getBuiltinModule('node:module')
      const requireFromApp = moduleApi.createRequire(path.join(electron.app.getAppPath(), 'package.json'))
      const Database = requireFromApp('better-sqlite3')

      if (!Database) {
        throw new Error('better-sqlite3 default export unavailable in Electron main process')
      }

      const dbPath = path.join(electron.app.getPath('userData'), 'cradle.db')
      const db = new Database(dbPath, { readonly: true })

      try {
        return db.prepare(sql).all(...params) as T[]
      }
      finally {
        db.close()
      }
    },
    { sql, params },
  )
}
