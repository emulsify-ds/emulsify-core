export default {
  testEnvironment: 'jsdom',
  testMatch: ['<rootDir>/{components,src}/**/*.{test,spec}.{js,mjs,cjs}'],
  collectCoverageFrom: [
    'components/**/*.{js,mjs,cjs}',
    'src/**/*.{js,mjs,cjs}',
  ],
  coverageDirectory: '.coverage',
  passWithNoTests: true,
};
