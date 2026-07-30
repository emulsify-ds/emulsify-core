/**
 * @file Shared conventional-commit analysis options for release automation.
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

const parserOpts = {
  noteKeywords: ['BREAKING CHANGE', 'BREAKING CHANGES', 'BREAKING'],
};

const commitAnalyzerOptions = {
  preset: 'angular',
  releaseRules,
  parserOpts,
};

module.exports = {
  commitAnalyzerOptions,
  parserOpts,
  releaseRules,
};
