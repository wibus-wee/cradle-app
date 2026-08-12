/** @type {import('electron-builder').Configuration} */
const config = {
  appId: 'com.cradle.m0-gate',
  productName: 'Cradle M0 Gate',
  executableName: 'cradle-m0-gate',
  asar: true,
  npmRebuild: false,
  directories: {
    output: 'release/m0',
  },
  extraMetadata: {
    name: 'cradle-m0-gate',
    main: 'dist/m0/main/index.js',
  },
  files: [
    'dist/m0/**/*',
  ],
  extraResources: [
    {
      from: 'dist/m0/fixture-resources',
      to: 'm0',
      filter: ['**/*'],
    },
  ],
  mac: {
    identity: null,
    target: ['dir'],
  },
  win: {
    target: ['dir'],
  },
  linux: {
    category: 'Development',
    target: ['dir'],
  },
}

export default config
