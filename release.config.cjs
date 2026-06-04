/**
 * @file Semantic Release configuration.
 */

const releaseRules = [
  // The 4.x branch contains this compatibility break before release automation
  // enforced BREAKING footers, so classify it as the major-release trigger.
  {
    type: 'feat',
    subject: 'remove storybook-html in favor of storybook-react v9.x',
    release: 'major',
  },
];

module.exports = {
  branches: ['main'],
  repositoryUrl: 'https://github.com/emulsify-ds/emulsify-core.git',
  plugins: [
    // Conventional commit analysis determines the next release version.
    [
      '@semantic-release/commit-analyzer',
      {
        preset: 'angular',
        releaseRules,
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
