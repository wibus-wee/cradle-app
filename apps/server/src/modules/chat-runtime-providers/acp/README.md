# ACP Chat Runtime

This package is Cradle's ACP client runtime. It launches a registered ACP agent over stdio and projects its native session lifecycle into the shared Chat Runtime contract.

`connection-manager.ts` is the ACP SDK boundary. It uses the official fluent `client({ name })` API, registers typed client-side request and notification handlers, then retains the resulting `ClientConnection` for the provider's lifetime. Agent calls are made through the connection's typed `agent` context.

The boundary owns protocol adaptation only:

- session creation, load, resume, prompt, cancellation, and config options;
- registered stdio MCP-server context injected into every session lifecycle request;
- permission and client-file-write requests bridged to Cradle's runtime approval flow;
- ACP session updates mapped to Chat Runtime chunks, titles, usage, and cached session state.

ACP's model selector is a standard session config option with `category: "model"`; selecting an installed agent opens a draft ACP session to read those native choices before the first message. Cradle carries that draft session into the created chat session and sends `session/set_config_option` only when the requested model is an exact advertised option value. Client filesystem writes remain fail-closed until the runtime approval handler explicitly allows that one write.
