import { join } from 'node:path'

/**
 * electron-builder unpacks native modules beside app.asar. Resolve from the
 * application root instead of a bundled chunk's __dirname: main-process code
 * splitting makes the latter point at dist/main/chunks.
 */
export function resolveStagedNativeAddonPath(appPath: string, filename: string): string {
  const unpackedAppPath = appPath.replace(/app\.asar$/, 'app.asar.unpacked')
  return join(unpackedAppPath, 'dist', 'main', 'native', filename)
}
