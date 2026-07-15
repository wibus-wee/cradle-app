# ACP Module

HTTP-first ACP management capability for registry browsing, package-distribution installation resources, installed-agent inventory, and audit queries.
Route metadata includes `x-cradle-cli` descriptors for generated CLI commands.

Binary distributions are deliberately unavailable until the official registry supplies a trusted publisher checksum. Registry responses and supported distribution types expose only `npx` and `uvx`; binary installation requests return the stable `acp_binary_integrity_metadata_missing` error.

## Files

- **index.ts**: HTTP endpoints for ACP management, including installation resource routes.
- **service.ts**: capability semantics and orchestration, using shared timestamp helpers for install/audit persistence.
- **acp.registry.ts**: remote registry fetch and package distribution helpers.
- **acp.installer.ts**: package-install resolution and the binary integrity-policy boundary.
