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
4. Run the package's focused typecheck and build. Fix manifest and build errors
   before loading the Plugin.
5. Preview with `cradle plugin dev --package-dir <absolute-package-dir>`. Keep
   the process attached while iterating; successful builds reload only their
   affected runtime layer.
6. Verify the Plugin descriptor, contribution registration, and the behavior
   requested by the user. Do not treat a successful build as runtime proof.

## Persistent Installation And Updates

Use Cradle commands rather than direct HTTP or registry edits:

```bash
cradle plugin source add \
  --kind localPath \
  --location <absolute-package-dir> \
  --label <display-label> \
  --added-reason <reason>
```

Adding a source discovers the package but does not authorize arbitrary local
code. Before calling `cradle plugin set-enabled`, show the user the Plugin
identity, layers, declared permissions, and source location, then obtain their
explicit approval. Enabling an external local Plugin records an operator trust
grant for that exact package checksum.

For an installed local source, edit and verify the package first, then run:

```bash
cradle plugin source refresh <source-id>
```

A code change produces a new checksum and invalidates the previous trust grant.
Obtain explicit approval before enabling the new revision. Never weaken this
boundary by editing trust storage, install receipts, or Cradle registry files.

For uninstall, inspect the Cradle-owned uninstall plan and present its retained
data, managed resources, and blockers before confirmation. Do not delete the
source directory as a substitute for the uninstall lifecycle.
