# CLIProxyAPI for Cradle

This desktop plugin installs CLIProxyAPI as an optional Managed Resource, runs it as a loopback-only sidecar, and projects the sidecar as an OpenAI-compatible external provider target.

The plugin package and CLIProxyAPI executable have separate lifecycles. Installing the plugin adds the integration only. Installing `CLIProxyAPI runtime` from Resources downloads the current upstream release metadata, checksum manifest, and matching platform archive through Cradle Download Center. The archive is verified, safely extracted into versioned plugin storage, and selected through an atomic `current.json` receipt.

The sidecar configuration and OAuth account directory live below the plugin's Cradle-owned data directory. Removing the managed runtime deletes only versioned executable files. Removing the plugin first shows its process, managed runtime, generated configuration, and preserved OAuth account data; confirmed removal stops the sidecar, removes the runtime and generated secrets, preserves account files, and only then deletes the integration package.

## User flows

1. Enable the plugin, open Resources, and install `CLIProxyAPI runtime`.
2. Open the CLIProxyAPI panel, choose a loopback port, and start the sidecar.
3. Add OAuth account files with CLIProxyAPI's own login workflow. Cradle leaves account selection, cooldown, and failover semantics inside CLIProxyAPI.
4. Refresh Providers. Cradle projects one OpenAI-compatible target backed by the local sidecar and its discovered `/v1/models` inventory.

To update the executable, use the managed resource's Update action. Cradle reads the current upstream release, verifies the published SHA-256 checksum, and atomically switches versions without touching account files.

To remove the integration, use Uninstall in Plugin Center. The confirmation dialog enumerates processes, managed resources, removed data, and preserved data. If stopping the sidecar, uninstalling the runtime, or plugin cleanup fails, the source remains installed so the same operation can be retried.
