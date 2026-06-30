import 'dotenv/config'

import { BridgeServer } from './bridge-server.js'
import { PendingCallManager } from './pending-calls.js'
import { SlackBot } from './slack-bot.js'
import { BridgeStore } from './store.js'

function requireEnv(name: string): string {
  const val = process.env[name]
  if (!val) {
    console.error(`Missing required env var: ${name}`)
    process.exit(1)
  }
  return val
}

async function main() {
  const botToken = requireEnv('SLACK_BOT_TOKEN')
  const appToken = requireEnv('SLACK_APP_TOKEN')
  const signingSecret = requireEnv('SLACK_SIGNING_SECRET')
  const socketPath = process.env.ZHI_SOCKET_PATH || '/tmp/zhi-bridge.sock'

  // Initialize components
  const store = new BridgeStore()
  const pendingCalls = new PendingCallManager()

  const slackBot = new SlackBot(
    { botToken, appToken, signingSecret },
    store,
    pendingCalls,
  )

  const bridgeServer = new BridgeServer(
    { socketPath },
    store,
    pendingCalls,
    slackBot,
  )

  // Start services
  await slackBot.start()
  await bridgeServer.start()

  console.warn('[main] Zhi Slack Bridge running')
  console.warn(`[main] Socket: ${socketPath}`)
  console.warn('[main] Waiting for zhi calls...')

  // Graceful shutdown
  const shutdown = async () => {
    console.warn('\n[main] Shutting down...')
    pendingCalls.cancelAll()
    await bridgeServer.stop()
    await slackBot.stop()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error('[main] Fatal:', err)
  process.exit(1)
})
