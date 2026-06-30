import { collectCheckReport, writeMissingReport } from './utils'

const report = await collectCheckReport()
await writeMissingReport(report)

if (report.summary.missingKeys > 0 || report.summary.extraKeys > 0 || report.summary.invalidEntries > 0) {
  console.error(JSON.stringify(report.summary, null, 2))
  process.exitCode = 1
}
