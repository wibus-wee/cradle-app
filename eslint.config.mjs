// @ts-check
import { defineConfig } from 'eslint-config-hyoban'

export default defineConfig(
  {
    lessOpinionated: true,
    react: true,
    tailwindcss: false,
    ignores: [
      '**/components/ui/**',
      '**/routeTree.gen.ts',
      '**/api-gen/**',
      'apps/server/src/modules/chat-runtime-providers/codex/app-server-protocol/**',
      'apps/server/src/modules/chat-runtime-providers/codex/app-server-capabilities.ts',
      '.agents/**',
      '.claude/**',
      '.tools/**',
      'apps/desktop/scripts/**',
      'docs/design-system/tokens.json',
      '**/dist/**',
      '**/build/**',
      '**/out/**',
      '**/coverage/**',
      '**/*.tsbuildinfo',
      '**/*.md',
      'packages/cli/**',
    ],
  },
  {
    settings: {
      tailwindcss: {
        whitelist: ['center'],
      },
    },
    rules: {
      'unicorn/prefer-math-trunc': 'off',
      '@eslint-react/no-clone-element': 0,
      '@eslint-react/hooks-extra/no-direct-set-state-in-use-effect': 0,
      'no-restricted-syntax': 0,
      'react-google-translate/no-conditional-text-nodes-with-siblings': 0,
      'e18e/prefer-static-regex': 'off',
      'style/max-statements-per-line': 'off',
      'react-refresh/only-export-components': 'warn',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/rules-of-hooks': 'warn',
      'react-dom/no-flush-sync': 'off',
      'ts/no-use-before-define': 'off',
      'no-console': 'off',
      'no-alert': 'off',
      'no-control-regex': 'off',
      'no-fallthrough': 'off',
      'no-unreachable-loop': 'off',
      'regexp/no-super-linear-backtracking': 'off',
      'regexp/no-unused-capturing-group': 'off',
      // Node globals in server code
      'node/prefer-global/process': 'off',
      'node/prefer-global/buffer': 'off',
      'style/indent': 'off',
    },
  },
  {
    files: ['**/*.tsx'],
    rules: {
      '@stylistic/jsx-self-closing-comp': 'error',
    },
  },
  {
    // TanStack Router writes both Route config and component in the same file
    files: ['**/routes/**/*.tsx', '**/routes/**/*.ts'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
)
