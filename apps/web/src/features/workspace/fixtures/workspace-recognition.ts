import type { WorkspaceRecognition } from '../use-workspace'

export const workspaceRecognitionFixtures = {
  valid: {
    path: '/Users/demo/cradle-suite',
    inspection: {
      path: '/Users/demo/cradle-suite',
      cradleWorkspaceDetected: true,
      config: {
        name: 'Cradle Suite',
        folders: [
          { name: 'Desktop', path: '/Users/demo/cradle-suite/apps/desktop' },
          { name: 'Server', path: '/Users/demo/cradle-suite/apps/server' },
        ],
      },
      configValid: true,
      configError: null,
      featureFlagEnabled: true,
      alreadyImported: false,
      recommendedAction: 'multi-folder',
    },
  },
  experimental: {
    path: '/Users/demo/experimental-suite',
    inspection: {
      path: '/Users/demo/experimental-suite',
      cradleWorkspaceDetected: true,
      config: {
        name: 'Experimental Suite',
        folders: [
          {
            name: 'Application',
            path: '/Users/demo/experimental-suite/application',
          },
        ],
      },
      configValid: true,
      configError: null,
      featureFlagEnabled: false,
      alreadyImported: false,
      recommendedAction: 'multi-folder',
    },
  },
  imported: {
    path: '/Users/demo/imported-suite',
    inspection: {
      path: '/Users/demo/imported-suite',
      cradleWorkspaceDetected: true,
      config: {
        name: 'Imported Suite',
        folders: [
          { name: 'Web', path: '/Users/demo/imported-suite/apps/web' },
        ],
      },
      configValid: true,
      configError: null,
      featureFlagEnabled: true,
      alreadyImported: true,
      recommendedAction: 'multi-folder',
    },
  },
  invalid: {
    path: '/Users/demo/broken-suite',
    inspection: {
      path: '/Users/demo/broken-suite',
      cradleWorkspaceDetected: true,
      config: null,
      configValid: false,
      configError: 'folders[1].path must be an absolute path',
      featureFlagEnabled: true,
      alreadyImported: false,
      recommendedAction: 'single-folder',
    },
  },
} satisfies Record<string, WorkspaceRecognition>
