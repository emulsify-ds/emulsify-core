// release.config.mjs
import analyzeCommits from '@semantic-release/commit-analyzer';
import { parserOpts } from 'conventional-changelog-angular';
import generateNotes from '@semantic-release/release-notes-generator';
import npm from '@semantic-release/npm';
import github from '@semantic-release/github';

export default {
  branches: ['main'],
  repositoryUrl: 'git@github.com:emulsify-ds/emulsify-core.git',
  plugins: [
    // Pass the actual function + its parserOpts
    [analyzeCommits, { parserOpts }],
    [generateNotes, { writerOpts: /* optional: conventionalChangelogAngular.writerOpts */ }],
    [npm, { npmPublish: false }],
    [github],
  ],
};
