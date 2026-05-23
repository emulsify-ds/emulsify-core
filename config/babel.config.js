/**
 * @file Babel configuration for test and legacy transpilation paths.
 */

export default (api) => {
  api.cache(true);

  // Disable Babel's generated comments so minified output stays compact.
  const presets = [['minify', { builtIns: false }]];
  const comments = false;

  return { presets, comments };
};
