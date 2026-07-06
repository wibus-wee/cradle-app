import { shutdownInfra } from '../src/infra'
import { rebuildSessionProjections } from '../src/modules/chat-runtime/es/rebuild'

const sessionId = process.argv[2]

if (!sessionId) {
  console.error('Usage: tsx scripts/chat-es-rebuild.ts <sessionId>')
  process.exitCode = 2
}
 else {
  try {
    const result = await rebuildSessionProjections(sessionId)
    console.log(JSON.stringify(result, null, 2))
    if (result.parity.unexplainedDiffs.length > 0) {
      process.exitCode = 1
    }
  }
 finally {
    shutdownInfra()
  }
}
