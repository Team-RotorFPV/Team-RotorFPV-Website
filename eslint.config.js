import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // Built output, the Node server (own tooling), one-off scripts, and vendored
  // third-party files in public/ (e.g. the Draco decoder).
  globalIgnores(['dist', 'server', 'src/scripts', 'public']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      'no-unused-vars': ['error', { 'varsIgnorePattern': '^React$' }],
      'no-useless-assignment': 'off'
    }
  },
])
