/**
 * @file Semantic Release configuration.
 */

module.exports = {
  branches: ['main'],
  repositoryUrl: 'git@github.com:emulsify-ds/emulsify-core.git',
  plugins: [
    // Conventional commit analysis determines the next release version.
    [
      '@semantic-release/commit-analyzer',
      {
        preset: 'angular',
        parserOpts: {
          noteKeywords: ['BREAKING CHANGE', 'BREAKING CHANGES', 'BREAKING'],
        },
      },
    ],
    [
      '@semantic-release/release-notes-generator',
      {
        preset: 'angular',
        parserOpts: {
          noteKeywords: ['BREAKING CHANGE', 'BREAKING CHANGES', 'BREAKING'],
        },
        writerOpts: {
          commitsSort: ['subject', 'scope'],
        },
      },
    ],
    ['@semantic-release/npm', { npmPublish: true }],
    '@semantic-release/github',
  ],
};
