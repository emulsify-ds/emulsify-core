/**
 * @fileoverview Configures Twig alias resolution for the project.
 */

import { basename, dirname, resolve } from 'path';
import { sync as globSync } from 'glob';
import fs from 'fs-extra';
import emulsifyConfig from '../../../../../project.emulsify.json' with { type: 'json' };

// Create __filename from import.meta.url without fileURLToPath
let _filename = decodeURIComponent(new URL(import.meta.url).pathname);

// On Windows, remove the leading slash (e.g. "/C:/path" -> "C:/path")
if (process.platform === 'win32' && _filename.startsWith('/')) {
  _filename = _filename.slice(1);
}

const _dirname = dirname(_filename);

const projectDir = resolve(_dirname, '../../../../..');
const projectName = emulsifyConfig.project.name;
const srcDir = fs.pathExistsSync(resolve(projectDir, 'src'))
  ? resolve(projectDir, 'src')
  : resolve(projectDir, 'components');

const aliasPattern = resolve(srcDir, '**/!(_*).twig');

/**
 * Get all top-level directory names from a source directory.
 *
 * @param {string} source - The source directory path.
 * @returns {string[]} Array of directory names.
 */
function getDirectories(source) {
  const dirs = fs
    .readdirSync(source, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name);
  return dirs;
}

/**
 * Remove numbering from a directory name if present.
 *
 * @param {string} dir - The original directory name.
 * @returns {string} The cleaned directory name.
 */
function cleanDirectoryName(dir) {
  if (/^\d{2}/.test(dir)) {
    return dir.slice(3);
  }
  return dir;
}

/**
 * Generate a set of Twig aliases from a glob pattern.
 *
 * @param {string} aliasMatcher - The glob pattern to match Twig files.
 * @returns {Object} An object containing Twig aliases.
 */
function getAliases(aliasMatcher) {
  let aliases = {};
  globSync(aliasMatcher).forEach((file) => {
    const filePath = file.split(`${srcDir}/`)[1];
    const fileName = basename(filePath);
    if (emulsifyConfig.project.platform === 'drupal') {
      aliases[`${projectName}/${fileName.replace('.twig', '')}`] = file;
    }
  });
  const dirs = getDirectories(srcDir);
  dirs.forEach((dir) => {
    const name = cleanDirectoryName(dir);
    Object.assign(aliases, {
      [`@${name}`]: `${projectDir}/${basename(srcDir)}/${dir}`,
    });
  });
  return aliases;
}

const TwigResolve = {
  extensions: ['.twig'],
  alias: getAliases(aliasPattern),
};

export default { TwigResolve };
