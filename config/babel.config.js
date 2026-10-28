export default (api) => {
  const isTest = api.env('test');

  const presets = [
    ...(isTest
      ? [['@babel/preset-env', { targets: { node: 'current' } }]]
      : []),
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
