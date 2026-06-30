# Database Module

SQLite lifecycle for the server runtime (connect → set runtime pragmas → migrate → provide).

## Files

- **database.config.ts**: Reads database and migration paths from ServerConfig.
- **database.provider.ts**: SQLite + drizzle instance with foreign keys, WAL journaling, and a busy timeout enabled.
- **migration-runner.ts**: Runs migrations from the configured migration directory on module init.
- **db-accessor.ts**: Exposes `get()` for db usage.
