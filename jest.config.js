process.env.AUTOMERGE_DATA_DIR = '.data-jest';

/** @type {import('jest').Config} */
module.exports = {
  projects: [
    // Backend + shared logic tests (node environment)
    {
      displayName: 'server',
      preset: 'ts-jest',
      testEnvironment: 'node',
      testTimeout: 15000,
      globalSetup: '<rootDir>/tests/setup.js',
      setupFiles: ['<rootDir>/tests/setup-subduction.js'],
      roots: ['<rootDir>/src', '<rootDir>/tests'],
      testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
      testPathIgnorePatterns: ['\\.test\\.tsx$', '/clipboard\\.test\\.ts$'],
      transform: {
        '^.+\\.ts$': ['ts-jest', { diagnostics: false }],
        '^(?!.*(?:setup|teardown)\\.js).+\\.js$': ['ts-jest', { useESM: false, diagnostics: false }],
      },
      transformIgnorePatterns: [
        'node_modules/(?!(@automerge/|@keyhive/))',
      ],
      moduleNameMapper: {
        '^@automerge/automerge/slim$': '<rootDir>/node_modules/@automerge/automerge/dist/cjs/fullfat_node.cjs',
        '^@automerge/automerge/slim/next$': '<rootDir>/node_modules/@automerge/automerge/dist/cjs/fullfat_node.cjs',
        '^@automerge/automerge-repo/slim$': '<rootDir>/node_modules/@automerge/automerge-repo/dist/entrypoints/slim.js',
        '^@automerge/automerge-repo-subduction-bridge$': '<rootDir>/tests/subduction-bridge-shim.js',
        '^@keyhive/keyhive/slim$': '<rootDir>/tests/keyhive-shim.js',
        '^@keyhive/keyhive/keyhive_wasm\\.base64\\.js$': '<rootDir>/tests/keyhive-base64-shim.js',
      },
    },
    // UI component tests (jsdom environment)
    {
      displayName: 'ui',
      preset: 'ts-jest',
      testEnvironment: 'jsdom',
      roots: ['<rootDir>/src/client'],
      testMatch: ['**/?(*.)+(spec|test).tsx', '**/clipboard.test.ts'],
      transform: {
        '^.+\\.tsx?$': ['ts-jest', {
          diagnostics: false,
          tsconfig: {
            jsx: 'react-jsx',
            jsxImportSource: 'preact',
            module: 'CommonJS',
            esModuleInterop: true,
            skipLibCheck: true,
            paths: {
              '@/*': ['./src/client/*'],
              'react': ['./node_modules/preact/compat/'],
              'react-dom': ['./node_modules/preact/compat/'],
            },
          },
        }],
      },
      moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/client/$1',
        '^@testing-library/preact$': '<rootDir>/node_modules/@testing-library/preact/dist/cjs/index.js',
        '^preact/jsx-runtime$': '<rootDir>/node_modules/preact/jsx-runtime/dist/jsxRuntime.js',
        '^preact/test-utils$': '<rootDir>/node_modules/preact/test-utils/dist/testUtils.js',
        '^preact/hooks$': '<rootDir>/node_modules/preact/hooks/dist/hooks.js',
        '^preact/compat$': '<rootDir>/node_modules/preact/compat/dist/compat.js',
        '^preact$': '<rootDir>/node_modules/preact/dist/preact.js',
        '^react$': '<rootDir>/node_modules/preact/compat/dist/compat.js',
        '^react-dom$': '<rootDir>/node_modules/preact/compat/dist/compat.js',
        '^react-dom/test-utils$': '<rootDir>/node_modules/preact/test-utils/dist/testUtils.js',
        '\\.css$': '<rootDir>/src/client/__mocks__/style.js',
      },
    },
  ],
  collectCoverageFrom: [
    'src/**/*.ts',
    'src/**/*.tsx',
    '!src/**/*.d.ts',
  ],
  coverageDirectory: 'coverage/jest',
  coverageReporters: ['json', 'text-summary'],
};
