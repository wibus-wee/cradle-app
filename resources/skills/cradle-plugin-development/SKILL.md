---
name: cradle-plugin-development
description: Create, develop, debug, install, or update Cradle plugins built with @cradleapp/plugin-sdk. Use for Cradle server, web, or desktop plugin packages and Agent-authored personal plugins. Do not use for Codex .codex-plugin packages or one-off Cradle Artifacts.
---

# Cradle Plugin Development

Build against the Plugin SDK guide bundled with the running Cradle version. The
guide owns architecture, manifest, API, lifecycle, and security semantics; this
Skill owns only the Agent workflow. Do not copy API contracts from the guide
into generated project documentation.

## Read The Canonical Guide

Start with the topic index:

```bash
cradle plugin docs
```

Read only the topics needed for the task:

```bash
cradle plugin docs getting-started
cradle plugin docs package-structure
cradle plugin docs server-plugin-api
cradle plugin docs web-plugin-api
cradle plugin docs desktop-plugin-api
cradle plugin docs react-sharing
cradle plugin docs validation
```

Use `cradle plugin docs all` only when the task genuinely spans the complete
Plugin system. Use `cradle man plugin` for the current management command
contract.

For exact signatures, generics, or optional fields, inspect the declarations
installed with the SDK at
`node_modules/@cradleapp/plugin-sdk/dist/*.d.ts`. In the Cradle monorepo, inspect
`packages/plugin-sdk/src/*.ts`. Never invent a Plugin API or duplicate those
contracts into package documentation.

## Choose The Correct Surface

- Use an Artifact for a session-bound interactive result that needs no host
  integration or persistent Plugin lifecycle.
- Use a Cradle Plugin for a reusable capability with a server, web, or desktop
  layer, Plugin-owned storage, commands, panels, routes, MCP servers, or other
  declared contributions.
- A Codex `.codex-plugin/plugin.json` package is a different protocol. Never use
  Codex marketplace scaffolding or manifests for a Cradle Plugin.

## Authoring Workflow

1. Inspect an existing package before changing it. For a new package, create it
   only in the workspace or another directory explicitly selected by the user.
   Never write Plugin source into another owner's namespace such as
   `~/.agents`.
2. Read the getting-started, package-structure, and relevant layer topics.
   Import SDK contracts from their owning package instead of recreating types.
3. Declare every capability and permission in `package.json`. Keep production
   entries separate from `cradle.dev` source entries.
4. Create or update `README.md`. Document the Plugin's purpose, user-facing
   capabilities, declared permissions, configuration, build and verification
   commands, and known constraints. Link to the canonical guide for SDK
   semantics instead of copying it.
5. Give the package an explicit finite `build` script. Run its focused
   typecheck, tests where warranted, and build; fix all manifest and production
   entry failures before installation.
6. Verify the Plugin descriptor, contribution registration, and requested
   behavior. Do not treat a successful build as runtime proof.

## Persistent Installation And Updates

The default Agent path is a finite install transaction:

```bash
cradle plugin install --package-dir <absolute-package-dir>
```

The CLI runs the package build, validates the npm-packed production package,
installs an immutable Cradle-owned snapshot, prints its source id, and exits.
The authoring directory remains available for later edits but is never the
runtime directory.

Installation does not authorize arbitrary local code. The install command
returns each Plugin's runtime-layer status. When invoked from Cradle Chat, a
native review handoff appears in that originating conversation; let the user
review identity, layers, declared permissions, retained source location, and
installed checksum there. Outside Chat, direct the user to Plugin Center.
Approval records package trust and the reviewed permission grants for that
exact checksum; never attempt to approve the Plugin on the user's behalf.

For an installed personal Plugin, edit and verify its retained source first,
then use the source id returned by installation:

```bash
cradle plugin update <source-id> --package-dir <absolute-package-dir>
```

Build, pack, or validation failure preserves the installed snapshot. A
successful update produces a new checksum and invalidates the previous package
and permission grants. Web, Server, and Desktop reconcile automatically after
the user approves the new revision. Never launch a dev process or manually
sync a runtime for an ordinary personal install, and never weaken the trust
boundary by editing trust storage, install receipts, or Cradle registry files.

## Explicit Developer Mode

Use `cradle plugin dev --package-dir <absolute-package-dir>` only when the user
explicitly requests watch mode, hot reload, interactive debugging, or Plugin
development. Keep the process attached while iterating and stop it when the
development session ends. Do not launch it as a background process or use it
for ordinary personal installation.

For uninstall, inspect the Cradle-owned uninstall plan and present its retained
data, managed resources, and blockers before confirmation. Do not delete the
source directory as a substitute for the uninstall lifecycle.
