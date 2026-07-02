# remote-hosts

Owns Cradle's registry of remote Cradle Server instances. A remote host row stores how the local Cradle Server reaches another Cradle Server, either through a direct HTTP(S) base URL for tests and trusted networks or through an SSH local port tunnel for ordinary remote machines.

Rows live in `remote_hosts`. The remote host module owns connection lifecycle, health probing, and proxying selected remote Cradle Server APIs. It must not write remote server identity into provider target namespaces.

## Files

- `index.ts`: Elysia route surface under `/remote-hosts`, including host CRUD, `/cradle-server/connect`, `/cradle-server/disconnect`, `/cradle-server/health`, and remote workspace file proxy routes.
- `model.ts`: TypeBox request and response schemas for remote host config, remote Cradle Server health, workspace list, and file proxy responses.
- `service.ts`: Drizzle-backed host registry, SSH/direct URL connection lifecycle, health checks, and remote workspace proxy functions.
- `remote-cradle-client.ts`: Small HTTP client for calling the target Cradle Server's existing `/health` and `/workspaces` APIs.
- `cradle-server-tunnel.ts`: OpenSSH local TCP port-forwarding helper for reaching a target Cradle Server through an SSH profile.

## Connection Config

A direct URL host uses:

    {
      "transport": "direct-url",
      "baseUrl": "http://127.0.0.1:21423"
    }

An SSH host uses:

    {
      "transport": "ssh",
      "ssh": {
        "hostName": "devbox.local",
        "user": "wibus",
        "port": 22,
        "auth": "default"
      }
    }

The Cradle Server capability controls where the SSH tunnel connects after reaching the target machine:

    {
      "cradleServer": {
        "enabled": true,
        "remoteHost": "127.0.0.1",
        "remotePort": 21423
      }
    }

## Ownership Boundary

This module deliberately does not define a second remote agent protocol. The target Cradle Server already owns workspace, session, runtime, provider, and file semantics. Local Cradle connects to that server and calls its HTTP APIs. If a new remote capability is needed, add it to the owning target Cradle Server module first, then proxy it here only when the local product needs that projection.
