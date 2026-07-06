import { shutdownInfra } from '../src/infra'
import { checkChatSessionProjectionParity } from '../src/modules/chat-runtime/es/parity'

const sessionId = process.argv[2]

if (!sessionId) {
  console.error('Usage: tsx scripts/chat-es-parity.ts <sessionId>')
  process.exitCode = 2
} else {
  try {
    const report = checkChatSessionProjectionParity(sessionId)
    console.log(JSON.stringify(report, null, 2))
    if (report.unexplainedDiffs.length > 0) {
      process.exitCode = 1
    }
  } finally {
    shutdownInfra()
  }
}
