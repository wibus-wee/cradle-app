# ACP Module

HTTP-first ACP management capability for registry browsing, installation lifecycle resources, installed-agent inventory, and audit queries.
Route metadata includes `x-cradle-cli` descriptors for generated CLI commands.

## Files

- **acp.module.ts**: Tsuki module registration.
- **acp.controller.ts**: HTTP endpoints for ACP management, including installation resource routes.
- **acp.service.ts**: capability semantics and orchestration, using shared timestamp helpers for install/audit persistence.
- **acp.store.ts**: DB-backed ACP install/audit persistence.
- **acp.registry.ts**: remote registry fetch and distribution helpers.
- **acp.installer.ts**: binary/package install helpers for server runtime.
