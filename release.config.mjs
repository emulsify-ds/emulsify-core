// release.config.mjs
import analyzeCommits from '@semantic-release/commit-analyzer';
import generateNotes from '@semantic-release/release-notes-generator';
import npm from '@semantic-release/npm';
import github from '@semantic-release/github';

export default {
  branches: ['main'],
  repositoryUrl: 'git@github.com:emulsify-ds/emulsify-core.git',
  plugins: [
    [analyzeCommits, { preset: 'angular' }],
    [generateNotes],
    [npm, { npmPublish: false }],
    [github],
  ],
};
