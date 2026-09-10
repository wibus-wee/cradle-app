async function main() {
  const [serverUrl, packageDir] = process.argv.slice(2)
  const response = await fetch(new URL('/plugins/sources', serverUrl))
  if (!response.ok) {
    throw new Error(`Plugin source lookup failed: ${response.status} ${await response.text()}`)
  }
  const sources = await response.json()
  const source = sources.find(candidate => candidate.kind === 'personal' && candidate.location === packageDir)
  if (!source) {
    throw new Error(`Personal Plugin source was not found for ${packageDir}`)
  }
  process.stdout.write(source.id)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
