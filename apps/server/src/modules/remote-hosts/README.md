# remote-hosts

Owns Cradle's registry of remote Cradle Server instances. A remote host row stores how the local Cradle Server reaches another Cradle Server through a direct HTTP(S) base URL, an SSH local port tunnel, or a relay transport tunnel through relayd for machines without inbound network reachability.

Rows live in `remote_hosts`. The remote host module owns connection lifecycle, health probing, and transparent upstream proxying to the connected remote Cradle Server. It must not write remote server identity into provider target namespaces.

## Files

- `index.ts`: Elysia route surface under `/remote-hosts`, including host CRUD, `/cradle-server/connect`, `/cradle-server/disconnect`, `/cradle-server/health`, `/relay/claim`, and the transparent upstream gateway at `/:hostId/upstream/*`.
- `model.ts`: TypeBox request and response schemas for remote host config, relay claim input, and remote Cradle Server health.
- `service.ts`: Drizzle-backed host registry, SSH/direct URL/relay connection lifecycle, relay pairing claim, health checks, and upstream-backed workspace/file helpers used by the workspace module.
- `upstream.ts`: Transparent HTTP/SSE upstream fetch and proxy helpers that forward to the connected tunnel `localBaseUrl`.
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

A relay host starts with relay location but no pinned keys:

    {
      "transport": "relay",
      "relay": {
        "relayUrl": "https://relay.example.com"
      }
    }

or with a registry row owned by `relay-servers`:

    {
      "transport": "relay",
      "relay": {
        "relayServerId": "public-vps"
      }
    }

After `POST /remote-hosts/:hostId/relay/claim` succeeds, `service.ts` stores the
stable `roomId`, `pinnedHostPubkey`, and `controllerKeyRef` under the same
`relay` object. Future `POST /remote-hosts/:hostId/cradle-server/connect` calls
use those pinned values and do not require the pairing string again.

`controllerKeyRef` is the controller X25519 encryption key. The controller
Ed25519 relay assertion signing key is stored separately as the sibling secret
`relay-controller-sign-key:{hostId}` and is derived from no shared relayd secret.

The Cradle Server capability controls where the SSH tunnel connects after reaching the target machine:

    {
      "cradleServer": {
        "enabled": true,
        "remoteHost": "127.0.0.1",
        "remotePort": 21423
      }
    }

For relay transport, the host-side connector always bridges to the host server's
own configured local HTTP port. The controller still receives a local
`localBaseUrl`, so upstream forwarding and workspace helpers do not need a
separate relay code path.

## Upstream Gateway

After connect, callers reach the remote Cradle Server through:

    ALL /remote-hosts/:hostId/upstream/*

This forwards method, query string, headers (minus hop-by-hop), and body to the
connected `localBaseUrl`. Examples:

- `GET /remote-hosts/:hostId/upstream/health`
- `GET /remote-hosts/:hostId/upstream/workspaces`
- `GET /remote-hosts/:hostId/upstream/workspaces/:id/files`

The workspace module still exposes local `/workspaces/:id/files...` routes for
registered remote locators; those call the upstream-backed helpers in
`service.ts` rather than duplicating proxy routes here.

Linked chat sessions (plan 033+) forward **all** `/chat/sessions/:localSessionId/*`
requests through this gateway after rewriting to `remoteSessionId`, via the global
`linkedChatSessionProxyPlugin` in `app.ts`. Session delete cascades through
`DELETE /sessions/:id` upstream. See `session/remote-projection.ts` and
`session/README.md`.

## Ownership Boundary

This module deliberately does not define a second remote agent protocol. The target Cradle Server already owns workspace, session, runtime, provider, and file semantics. Local Cradle connects to that server and calls its HTTP APIs through the upstream gateway. If a new remote capability is needed, add it to the owning target Cradle Server module first; it becomes reachable automatically once exposed on the remote server.
