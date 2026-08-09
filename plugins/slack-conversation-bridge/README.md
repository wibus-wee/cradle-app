# Slack Conversation Bridge

This bundled plugin provides the Slack adapter for the server-owned `conversation-bridge` module.

The plugin owns Slack protocol behavior only: Socket Mode startup, `/cradle` controls, Slack event normalization, native `chat.*Stream` delivery, Agent thread status, tool task cards, stop/approval actions, and user-input modals. It does not store bridge rows, bind channels, create Cradle sessions, or call Cradle HTTP APIs. Those semantics live in `apps/server/src/modules/conversation-bridge`.

The adapter registers these Slack controls over Socket Mode:

- `/cradle bind workspace`
- `/cradle bind workspace <workspace-id>` for direct binding when the id is already known
- `/cradle status`
- `/cradle unbind`
- Workspace, runtime, and model selectors rendered in the status/bind response.
- Streaming Agent responses with Slack task progress for Cradle tool calls.
- Stop, tool approval, and Ask User interactions without leaving Slack.

Connection secrets are resolved by the server bridge supervisor and passed to this adapter as plaintext only at runtime. A Slack connection expects these secret keys:

- `botToken`: Slack bot token used by Web API calls.
- `appToken`: Slack app-level token used for Socket Mode.

Socket Mode does not require a signing secret. Existing connections may keep a `signingSecret` secret ref, but the adapter no longer requires one.

Connection config may include `logLevel` with `debug`, `info`, `warn`, or `error`.

The Settings guide links to a prefilled Slack app manifest. It enables Agent View, the Messages tab, Socket Mode, interactivity, `/cradle`, direct messages, channel messages, and the scopes required by the adapter.
