import { init, parse } from 'es-module-lexer'

export async function normalizeJavaScriptCellProgram(source: string): Promise<string> {
  await init
  const [, exports] = parse(source)
  const hasDefaultExport = exports.some(entry => entry.n === 'default')
  return hasDefaultExport ? source : `export default ${source}`
}
