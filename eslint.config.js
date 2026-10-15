import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/**', 'dist/**', 'coverage/**', 'artifacts/**',
      'test-results/**', 'playwright-report/**', 'reports/**'
    ]
  },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser, L: 'readonly', THREE: 'readonly' }
    },
    rules: {
      // Existing modules intentionally share some framework-bound callbacks;
      // semantic correctness rules below remain errors in the release gate.
      'no-unused-vars': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-control-regex': 'off',
      'no-misleading-character-class': 'off',
      'no-useless-catch': 'off',
      'no-useless-escape': 'off',
      'no-unreachable': 'error',
      'no-dupe-keys': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-constant-binary-expression': 'error',
      'no-fallthrough': 'error',
      'valid-typeof': 'error'
    }
  }
];
