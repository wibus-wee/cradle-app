import type { ServerConfig } from '../config/server-config'

export interface DatabaseOptions {
  dbPath: string
  dataDir?: string
  migrationsDir: string
}

export class DatabaseConfig {
  constructor(private readonly config: ServerConfig) {}

  getOptions(): DatabaseOptions {
    const cfg = this.config.get()
    return { dbPath: cfg.dbPath, dataDir: cfg.dataDir, migrationsDir: cfg.migrationsDir }
  }
}
