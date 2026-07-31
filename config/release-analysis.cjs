/**
 * @file Shared conventional-commit analysis options for release automation.
 */

// A matching rule here wins outright: `@semantic-release/commit-analyzer` only
// consults its default rules for commits that no custom rule matched, so a
// `patch` classification below is not overridden by `feat` normally implying a
// minor. String properties are matched with micromatch, so subjects are compared
// as globs — these are written in full rather than wildcarded so a later commit
// cannot fall into a rule by accident.
const releaseRules = [
  // The 4.x branch contains this compatibility break before release automation
  // enforced BREAKING footers, so classify it as the major-release trigger.
  {
    type: 'feat',
    subject: 'remove storybook-html in favor of storybook-react v9.x',
    release: 'major',
  },

  // The develop reporter shipped in 4.3.0. These three commits correct how it
  // behaves rather than adding a capability the previous release lacked: two
  // repair output that arrived garbled or duplicated, and the third reshapes the
  // summary the same reporter already printed. They were authored as `feat`
  // before that framing settled, and 4.3.1 is the honest release for them.
  {
    type: 'feat',
    subject: 'quiet rolldown and vite output during watch builds',
    release: 'patch',
  },
  {
    type: 'feat',
    subject: 'restructure the develop summary around project facts',
    release: 'patch',
  },
  {
    type: 'feat',
    subject: 'render the ready announcement through the reporter',
    release: 'patch',
  },

  // Held to the same framing as the three above, and deliberately: this commit
  // does add a capability 4.3.0 lacked, so on its own reading it is a minor. It
  // is classified as a patch because it belongs to the same corrective pass, and
  // 4.3.1 is the release that pass was scoped to. The detailed output and the
  // section headings are additions to a reporter the previous release already
  // shipped, reached through controls that release already documented.
  //
  // This is the last commit that gets this treatment. Anything further that adds
  // to the reporter is a `feat` on its own terms and should take the minor.
  {
    type: 'feat',
    subject: 'add a detailed mode and label the summary sections',
    release: 'patch',
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
