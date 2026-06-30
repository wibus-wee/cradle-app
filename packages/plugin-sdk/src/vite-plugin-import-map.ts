/* Provides a Vite-compatible import-map plugin for Cradle web plugin hosts. */

// Valid JS identifier; filters out keys like "module.exports".
const RE_VALID_IDENT = /^[a-z_$]\w*$/i

interface DevMiddlewareRequest {
  url?: string
}

interface DevMiddlewareResponse {
  setHeader: (name: string, value: string) => void
  end: (body?: string) => void
}

interface DevServerLike {
  middlewares: {
    use: (handler: (
      req: DevMiddlewareRequest,
      res: DevMiddlewareResponse,
      next: () => void,
    ) => void) => void
  }
}

interface TransformIndexHtmlContext {
  server?: unknown
}

interface HtmlTagDescriptor {
  tag: string
  attrs?: Record<string, string | boolean>
  children?: string
  injectTo?: 'head-prepend'
}

interface CradlePluginImportMapVitePlugin {
  name: string
  configureServer: (server: DevServerLike) => Promise<void>
  transformIndexHtml: {
    order: 'pre'
    handler: (html: string, ctx: TransformIndexHtmlContext) => HtmlTagDescriptor[]
  }
}

/**
 * Injects shared React import maps for runtime-loaded web plugin modules.
 *
 * The returned object is structurally compatible with Vite's plugin shape
 * without importing Vite types, which keeps desktop and web package type
 * resolution isolated under pnpm.
 */
export function pluginImportMap(): CradlePluginImportMapVitePlugin {
  const registryAccessor = `Symbol.for('cradle:modules')`
  const wrapperModules: Record<string, string> = {}

  const sharedPackages: Record<string, string> = {
    'react.mjs': 'react',
    'react-dom.mjs': 'react-dom',
    'react-jsx-runtime.mjs': 'react/jsx-runtime',
    'react-jsx-dev-runtime.mjs': 'react/jsx-dev-runtime',
    'react-dom-client.mjs': 'react-dom/client',
  }

  const registryKeys: Record<string, string> = {
    'react.mjs': 'react',
    'react-dom.mjs': 'react-dom',
    'react-jsx-runtime.mjs': 'react/jsx-runtime',
    'react-jsx-dev-runtime.mjs': 'react/jsx-dev-runtime',
    'react-dom-client.mjs': 'react-dom/client',
  }

  function buildWrapper(exports: string[], registryKey: string): string {
    const named = exports.filter(key =>
      key !== 'default' && key !== '__esModule' && !key.startsWith('__') && RE_VALID_IDENT.test(key))
    let code = `const __mod = window[${registryAccessor}]['${registryKey}'];\nexport default __mod;\n`
    if (named.length > 0) {
      code += `export const { ${named.join(', ')} } = __mod;\n`
    }
    return code
  }

  return {
    name: 'cradle-plugin-import-map',

    async configureServer(server) {
      for (const [fileName, packageName] of Object.entries(sharedPackages)) {
        try {
          const mod = await import(packageName)
          const exports = Object.keys(mod)
          wrapperModules[fileName] = buildWrapper(exports, registryKeys[fileName]!)
        }
 catch {
          wrapperModules[fileName] = `const __mod = window[${registryAccessor}]['${registryKeys[fileName]}'];\nexport default __mod;\n`
        }
      }

      server.middlewares.use((req, res, next) => {
        const prefix = '/__plugin-deps/'
        if (!req.url?.startsWith(prefix)) {
          next()
          return
        }

        const fileName = req.url.slice(prefix.length)
        const wrapper = wrapperModules[fileName]
        if (!wrapper) {
          next()
          return
        }

        res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Cache-Control', 'no-cache')
        res.end(wrapper)
      })
    },

    transformIndexHtml: {
      order: 'pre',
      handler(_html, ctx) {
        if (ctx.server) {
          const devTags: HtmlTagDescriptor[] = [
            {
              tag: 'script',
              attrs: {
                async: true,
                type: 'module',
                src: '/node_modules/es-module-shims/dist/es-module-shims.js',
              },
              injectTo: 'head-prepend',
            },
            {
              tag: 'script',
              attrs: { type: 'importmap' },
              children: JSON.stringify({
                imports: {
                  'react': '/__plugin-deps/react.mjs',
                  'react-dom': '/__plugin-deps/react-dom.mjs',
                  'react/jsx-runtime': '/__plugin-deps/react-jsx-runtime.mjs',
                  'react/jsx-dev-runtime': '/__plugin-deps/react-jsx-dev-runtime.mjs',
                  'react-dom/client': '/__plugin-deps/react-dom-client.mjs',
                },
              }),
              injectTo: 'head-prepend',
            },
          ]
          return devTags
        }

        const productionTags: HtmlTagDescriptor[] = [
          {
            tag: 'script',
            attrs: { type: 'importmap' },
            children: JSON.stringify({
              imports: {
                'react': './assets/vendor-react.js',
                'react-dom': './assets/vendor-react.js',
                'react/jsx-runtime': './assets/vendor-react.js',
                'react/jsx-dev-runtime': './assets/vendor-react.js',
                'react-dom/client': './assets/vendor-react.js',
              },
            }),
            injectTo: 'head-prepend',
          },
        ]
        return productionTags
      },
    },
  }
}
