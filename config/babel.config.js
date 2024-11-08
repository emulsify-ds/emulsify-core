module.exports = (api) => {
  api.cache(true);

  const presets = [['minify', { builtIns: false }]];

  const comments = false;

  return { presets, comments };
};
