# Remote Hosts

This module owns Cradle-local configuration for remote machines. A remote host is one machine profile with one shared connection config and capability-specific settings.

Rows live in `remote_hosts`. Chat-session-to-remote-agent links live in `remote_host_agentd_session_links`. These rows are Cradle application data; this module must not write remote host identity into provider target namespaces.

The durable row shape is:

```json
{
  "displayName": "Devbox",
  "connectionConfig": {
    "transport": "ssh",
    "ssh": {
      "hostName": "devbox.local",
      "user": "wibus",
      "auth": "identityFile",
      "identityFilePath": "~/.ssh/id_ed25519"
    }
  },
  "capabilities": {
    "agentd": {
      "enabled": true,
      "remoteSocketPath": "~/.cradle/agentd/agent.sock"
    },
    "cradleServer": {
      "enabled": true,
      "remoteHost": "127.0.0.1",
      "remotePort": 21423
    }
  }
}
```

`connectionConfig.transport` is explicit. `ssh` uses the system OpenSSH executable. `auth: "default"` means Cradle lets OpenSSH use the user's normal SSH config and agent. `auth: "identityFile"` adds `-i <identityFilePath>`. Port and raw `sshArgs` are advanced config fields and are not part of the normal UI.

`capabilities.agentd` owns the existing remote daemon behavior. Agentd routes live under `/remote-hosts/:hostId/agentd/...` and speak `@cradle/remote-agent-protocol` through either an SSH Unix-socket tunnel, a direct local socket for tests, or relay transport.

`capabilities.cradleServer` owns the new remote Cradle Server path. Cradle starts an OpenSSH local port-forwarding child process equivalent to:

```text
ssh -N -L 127.0.0.1:<localPort>:127.0.0.1:21423 user@remote
```

The HTTP routes under `/remote-hosts/:hostId/cradle-server/...` then call the remote server through `http://127.0.0.1:<localPort>`. The first accepted remote Cradle Server behavior is `/health`; workspace/session handoff semantics are intentionally outside this module's first milestone.

Relay remains scoped to the agentd capability. A pending relay host can be created with `connectionConfig.transport = "relay"` and no SSH profile. Pairing creates a Cradle-owned relay enrollment on the host config and stores only durable relay coordinates plus the enrollment secret hash. It must not persist WebSocket host/controller tokens.

Connection state is process-local and realtime. SQLite stores machine config and durable capability metadata only. If an SSH tunnel exits or a WebSocket closes, the configured host row remains and the user must reconnect explicitly.
