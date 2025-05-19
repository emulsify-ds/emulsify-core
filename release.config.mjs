// release.config.mjs
import commitAnalyzer from '@semantic-release/commit-analyzer';
import releaseNotes from '@semantic-release/release-notes-generator';
import npm from '@semantic-release/npm';
import github from '@semantic-release/github';

export default {
  tagFormat: '${version}',
  branches: ['main'],
  repositoryUrl: 'git@github.com:emulsify-ds/emulsify-core.git',
  plugins: [
    // explicit function + (optional) config object
    [commitAnalyzer, { preset: 'angular' }],
    [releaseNotes],
    [npm, { npmPublish: false }],
    [github],
  ],
};
