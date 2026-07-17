# ACP Module

HTTP-first ACP management capability for registry browsing, package-distribution installation resources, installed-agent inventory, draft-session model discovery, and audit queries.
Route metadata includes `x-cradle-cli` descriptors for generated CLI commands.

Binary distributions are available whenever the official registry supplies a target for the current platform. The server Download Center owns transfer, byte limits, optional checksum verification, retry, and artifact cleanup; ACP owns archive extraction and installation. Registry checksums are used when supplied but are not required for binary installation.

## Files

- **index.ts**: HTTP endpoints for ACP management, including installation resource routes, native draft-session model discovery, and Download Center dependency wiring.
- **service.ts**: capability semantics and orchestration, using shared timestamp helpers for install/audit persistence.
- **acp.registry.ts**: remote registry fetch and package distribution helpers.
- **acp.installer.ts**: package-install resolution plus binary archive extraction and installation after Download Center transfer.
