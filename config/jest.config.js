/**
 * @file Jest configuration for unit tests and coverage reporting.
 */

export default {
  rootDir: '..',
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.m?js$': [
      'babel-jest',
      {
        babelrc: false,
        configFile: false,
        presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
        plugins: ['./config/jest-transform-import-meta-url.js'],
      },
    ],
  },
  moduleNameMapper: {
    // Keep Jest mappings limited to virtual modules still used by Storybook.
    '^virtual:emulsify-twig-globs$':
      '<rootDir>/config/vite/test-utils/virtual-twig-globs.js',
    '^virtual:emulsify-twig-asset-sources$':
      '<rootDir>/config/vite/test-utils/virtual-twig-asset-sources.js',
  },
  coverageDirectory: '.coverage',
  coverageProvider: 'v8',
  // Keep thresholds conservative for now, and ratchet them upward as coverage improves.
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 80,
      lines: 85,
      statements: 85,
    },
  },
  testPathIgnorePatterns: [
    '<rootDir>/dist',
    '<rootDir>/vendor',
    '<rootDir>/.out',
  ],
};
