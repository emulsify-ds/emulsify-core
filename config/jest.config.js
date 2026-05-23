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
      },
    ],
  },
  coverageDirectory: '.coverage',
  coverageProvider: 'v8',
  // @TODO: once every file has 100% test coverage,
  // these thresholds should be updated.
  coverageThreshold: {
    global: {
      branches: 0,
      functions: 0,
      lines: 0,
      statements: 0,
    },
  },
  testPathIgnorePatterns: [
    '<rootDir>/dist',
    '<rootDir>/vendor',
    '<rootDir>/.out',
  ],
};
