export default (api) => {
  api.cache(true);

  const presets = [
    [
      'minify',
      {
        builtIns: false,
        mangle: {
          reserved: ['Drupal', 'drupalSettings', 'once'],
        },
      },
    ],
  ];
  const comments = false;

  return { presets, comments };
};
