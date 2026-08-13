/** @type {import('electron-builder').Configuration} */
const config = {
  appId: 'com.cradle.server-fetch-smoke',
  productName: 'Cradle Server Fetch Smoke',
  executableName: 'cradle-server-fetch-smoke',
  asar: true,
  npmRebuild: false,
  directories: { output: 'release/server-fetch-smoke' },
  extraMetadata: {
    name: 'cradle-server-fetch-smoke',
    main: 'dist/server-fetch-smoke/main/index.js',
  },
  files: ['dist/server-fetch-smoke/**/*'],
  mac: { identity: null, target: ['dir'] },
  win: { target: ['dir'] },
  linux: { category: 'Development', target: ['dir'] },
}

export default config
