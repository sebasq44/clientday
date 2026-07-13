/* eslint-env node */

/**
 * Configuración de ESLint para Día del Cliente 2026.
 * JavaScript + JSX (React 18). Sin TypeScript.
 */
module.exports = {
  root: true,

  env: {
    browser: true,
    es2022: true,
  },

  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },

  settings: {
    react: { version: 'detect' },
  },

  plugins: ['react', 'react-hooks'],

  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    // Vite usa el runtime automático de JSX: no hace falta importar React en cada archivo.
    'plugin:react/jsx-runtime',
    'plugin:react-hooks/recommended',
  ],

  ignorePatterns: ['dist', 'node_modules', 'apps-script'],

  rules: {
    // El proyecto es JavaScript puro: no documentamos props con prop-types.
    'react/prop-types': 'off',

    // Los console.error/warn son la bitácora de los servicios; console.log sí molesta.
    'no-console': ['warn', { allow: ['warn', 'error'] }],

    // Permite descartar variables a propósito (p. ej. `const { id, ...rest } = ticket`).
    'no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      },
    ],
  },

  overrides: [
    {
      // Archivos de configuración: se ejecutan en Node, no en el navegador.
      files: ['*.config.js', '*.config.cjs', '.eslintrc.cjs'],
      env: { node: true, browser: false },
    },
  ],
}
