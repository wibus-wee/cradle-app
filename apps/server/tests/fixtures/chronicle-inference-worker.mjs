import { createInterface } from 'node:readline'

async function main() {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
  let requestCount = 0

  for await (const line of lines) {
    const request = JSON.parse(line)
    requestCount += 1
    if (request.texts.includes('crash')) {
      process.stderr.write('forced inference worker crash\n')
      process.exit(23)
    }
    if (request.texts.includes('delay')) {
      await new Promise(resolve => setTimeout(resolve, 75))
    }
    const embeddings = request.texts.map(text => [requestCount, text.length])
    process.stdout.write(`${JSON.stringify({
      id: request.id,
      ok: true,
      result: {
        modelId: 'fake-model',
        modelVersion: 'v1',
        dimensions: 2,
        embeddings,
      },
    })}\n`)
  }
}

void main()
