import fs from 'fs-extra';
import { resolve, dirname } from 'path';
import { merge } from 'webpack-merge';
import common from './webpack.common.js';

// JSON import syntax may vary; adjust if you need `assert { type: 'json' }` instead
import emulsifyConfig from '../../../../../project.emulsify.json' with { type: 'json' };

// Create __filename from import.meta.url without fileURLToPath
let _filename = decodeURIComponent(new URL(import.meta.url).pathname);

// On Windows, remove the leading slash (e.g. "/C:/path" -> "C:/path")
if (process.platform === 'win32' && _filename.startsWith('/')) {
  _filename = _filename.slice(1);
}

const _dirname = dirname(_filename);

// Get directories for file contexts.
const projectDir = resolve(_dirname, '../../../../..');

const srcPath = resolve(projectDir, 'src');
const srcExists = fs.pathExistsSync(srcPath);
const isDrupal = emulsifyConfig.project.platform === 'drupal';

// Always ignore dist
const ignored = ['**/dist/**'];

// If it’s Drupal and there is no src/, also ignore components
if (isDrupal && !srcExists) {
  ignored.push('**/components/**');
}

export default merge(common, {
  mode: 'development',
  devtool: 'source-map',
  watch: true,
  watchOptions: {
    ignored,
  },
});
