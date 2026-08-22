/**
 * @file Semantic Release configuration.
 */

const {
  commitAnalyzerOptions,
  parserOpts,
} = require('./config/release-analysis.cjs');

module.exports = {
  branches: ['main'],
  repositoryUrl: 'https://github.com/emulsify-ds/emulsify-core.git',
  plugins: [
    // Deliberately omit @semantic-release/changelog and @semantic-release/git.
    // The develop workflow commits package versions before release, while the
    // generated GitHub Release is the only changelog; publishing must not write
    // or commit a second version bump or a CHANGELOG.md file.
    // Conventional commit analysis determines the next release version.
    ['@semantic-release/commit-analyzer', commitAnalyzerOptions],
    [
      '@semantic-release/release-notes-generator',
      {
        preset: 'angular',
        parserOpts,
        writerOpts: {
          commitsSort: ['subject', 'scope'],
        },
      },
    ],
    ['@semantic-release/npm', { npmPublish: true }],
    '@semantic-release/github',
  ],
};
