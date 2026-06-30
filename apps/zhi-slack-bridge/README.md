# Zhi Slack Bridge

MCP human-in-the-loop bridge：将 agent 的 `zhi` tool 调用路由到 Slack thread，等待用户回复后返回给 agent。

## Architecture

```
Agent Host (VS Code / Claude Desktop)
  └─ MCP Server (stdio) ── zhi tool call ──┐
                                            │ Unix Socket
                                            ▼
                                    Bridge Server
                                      ├── Pending Call Manager
                                      └── Slack Bot (Socket Mode)
                                            │
                                            ▼
                                    Slack Channel (fresh thread per call)
```

## Setup

### 1. Create Slack App

1. Go to https://api.slack.com/apps
2. Click **Create New App** → **From scratch**
3. Name: `Zhi Bridge` (or whatever you prefer)
4. Pick your workspace

### 2. Enable Socket Mode

1. In the app settings, go to **Socket Mode** (left sidebar)
2. Toggle **Enable Socket Mode** → ON
3. Create an App-Level Token:
   - Token Name: `zhi-socket`
   - Scope: `connections:write`
   - Click **Generate**
4. Copy the `xapp-...` token → this is your `SLACK_APP_TOKEN`

### 3. Configure Bot Token Scopes

1. Go to **OAuth & Permissions** (left sidebar)
2. Under **Bot Token Scopes**, add:
   - `chat:write` — Post messages
   - `commands` — Handle slash commands
  - `reactions:write` — Add reaction on receipt（可选，没有也不影响主流程）
   - `channels:history` — Read messages in public channels (for thread replies)
   - `groups:history` — Read messages in private channels (if needed)
3. Click **Install to Workspace** (or reinstall if already installed)
4. Copy the `xoxb-...` token → this is your `SLACK_BOT_TOKEN`

### 4. Register Slash Command

1. Go to **Slash Commands** (left sidebar)
2. Click **Create New Command**:
   - Command: `/zhi`
   - Request URL: (not needed for Socket Mode, but put any placeholder like `https://localhost`)
   - Short Description: `Manage Zhi agent bridge`
   - Usage Hint: `[bind|unbind|status]`
3. Save

### 5. Subscribe to Events

1. Go to **Event Subscriptions** (left sidebar)
2. Toggle **Enable Events** → ON
3. Under **Subscribe to bot events**, add:
   - `message.channels` — Messages in public channels
   - `message.groups` — Messages in private channels (if needed)
4. Save Changes

### 6. Get Signing Secret

1. Go to **Basic Information** (left sidebar)
2. Under **App Credentials**, copy **Signing Secret** → this is your `SLACK_SIGNING_SECRET`

### 7. Invite Bot to Channel

In Slack, go to the channel where you want zhi output:
- Type `/invite @Zhi Bridge` (or your bot's display name)

## Configuration

Create a `.env` file in `apps/zhi-slack-bridge/`:

```env
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-level-token
SLACK_SIGNING_SECRET=your-signing-secret

# Optional
ZHI_SOCKET_PATH=/tmp/zhi-bridge.sock
ZHI_DATA_DIR=~/.zhi-slack-bridge
```

## Running

### Start the Bridge

```bash
# Development
pnpm dev

# Production
pnpm build && pnpm start
```

### Configure MCP Client

Add to your MCP client config (e.g. Claude Desktop `claude_desktop_config.json` or VS Code settings):

```json
{
  "mcpServers": {
    "zhi-slack": {
      "command": "node",
      "args": ["/path/to/apps/zhi-slack-bridge/dist/mcp-server.js"],
      "env": {
        "ZHI_SOCKET_PATH": "/tmp/zhi-bridge.sock"
      }
    }
  }
}
```

## Usage

### 1. Bind Channel

In the Slack channel where you want zhi output:

```
/zhi bind
```

### 2. Agent Calls Zhi

When an agent calls the `zhi` tool:
- Bridge creates a fresh Slack thread for this call
- Bridge blocks until you reply in the thread

### 3. Reply in Slack

Reply in the thread. The bridge picks up your reply and returns it to the agent.

### 4. Check Status

```
/zhi status
```

Shows: bound channel and current in-flight zhi calls.

### 5. Unbind

```
/zhi unbind
```

## Runtime Model

- Every `zhi` tool call creates a brand new Slack thread.
- The bridge only keeps an in-memory mapping from `thread_ts` to the currently waiting tool call.
- Once you reply, that mapping is discarded immediately.
- The only persistent state is the bound Slack channel.
- Pending calls do **not** time out by default; they keep waiting until you reply or the bridge is explicitly shut down.
- The MCP side keeps retrying bridge socket reconnection during bridge restarts instead of failing fast.
- Long messages continue as additional thread replies, so the bridge no longer depends on Slack file-upload scopes.

## Development

```bash
pnpm test        # Run tests
pnpm test:watch  # Watch mode
pnpm typecheck   # Type check
pnpm build       # Build for production
```
