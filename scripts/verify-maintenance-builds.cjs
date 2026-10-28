/** Exercise the installed npm artifact in a disposable 3.x theme. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const cwd = path.resolve(process.argv[2] || '');
assert.ok(
  process.argv[2],
  'Usage: node scripts/verify-maintenance-builds.cjs <fixture-consumer>',
);
const manifest = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json')));
assert.match(
  manifest.name,
  /^emulsify-.*-fixture$/,
  'Only disposable validation consumers may be modified',
);
const core = path.join(cwd, 'node_modules/@emulsify/core');
function write(file, contents) {
  const target = path.join(cwd, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}
for (const directory of ['src', 'assets', 'config', 'project.emulsify.json']) {
  assert.ok(
    !fs.existsSync(path.join(cwd, directory)),
    `Fixture already contains ${directory}`,
  );
}
write(
  'project.emulsify.json',
  JSON.stringify({
    project: {
      name: 'fixture',
      machineName: 'fixture',
      platform: 'drupal',
      singleDirectoryComponents: true,
    },
  }),
);
write(
  'src/components/button/button.js',
  'window.fixtureButton = () => "ready";\n',
);
write(
  'src/components/button/button.scss',
  "@import 'parts/*';\n\n.button {\n  color: $button-color;\n  display: flex;\n}\n",
);
write('src/components/button/parts/_colors.scss', '$button-color: #123456;\n');
write(
  'src/components/button/button.twig',
  '<button class="button">{{ label }}</button>\n',
);
write('src/components/button/button.component.yml', 'name: Button\n');
write('src/components/button/button.yml', 'label: Maintenance fixture\n');
write(
  'src/components/button/button.stories.js',
  'import template from "./button.twig";\nimport args from "./button.yml";\nimport "./button.scss";\nexport default {title: "Components/Button", render: (args) => template(args), args};\nexport const Primary = {};\n',
);
write('config/emulsify-core/storybook/preview.js', 'export default {};\n');
write('config/emulsify-core/storybook/theme.js', 'export default {};\n');
write('config/emulsify-core/storybook/main.js', 'module.exports = {};\n');
write(
  '.stylelintrc.json',
  JSON.stringify({ extends: [path.join(core, 'config/.stylelintrc.json')] }),
);
for (const dir of ['assets/images', 'assets/icons', 'assets/videos', 'dist'])
  fs.mkdirSync(path.join(cwd, dir), { recursive: true });
write(
  'assets/icons/check.svg',
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M1 8h14"/></svg>',
);
fs.copyFileSync(
  path.join(core, 'assets/images/logo.png'),
  path.join(cwd, 'src/components/button/picture.png'),
);
write('dist/stale.js', 'stale generated output');
write('dist/keep.txt', 'keep unrelated output');

function run(name, bin, args) {
  const result = spawnSync(
    process.execPath,
    [path.join(cwd, 'node_modules', bin), ...args],
    {
      cwd,
      encoding: 'utf8',
      maxBuffer: 100 * 1024 * 1024,
    },
  );
  fs.writeFileSync(
    path.join(cwd, `${name}.log`),
    `${result.stdout || ''}\n${result.stderr || ''}`,
  );
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${name} failed; inspect ${cwd}/${name}.log`);
}
run('stylelint', 'stylelint/bin/stylelint.mjs', [
  'src/components/button/**/*.scss',
  '--config',
  '.stylelintrc.json',
]);
run('webpack-production', 'webpack-cli/bin/cli.js', [
  '--config',
  path.join(core, 'config/webpack/webpack.prod.js'),
]);
for (const file of [
  'components/button/button.js',
  'components/button/button.css',
  'components/button/button.twig',
  'components/button/button.component.yml',
  'components/button/picture.png',
  'dist/icons.svg',
  'dist/keep.txt',
])
  assert.ok(fs.existsSync(path.join(cwd, file)), `Missing output ${file}`);
assert.ok(
  !fs.existsSync(path.join(cwd, 'dist/stale.js')),
  'Clean stale JS while preserving other files',
);
assert.match(
  fs.readFileSync(path.join(cwd, 'components/button/button.css'), 'utf8'),
  /#123456/,
);
run('storybook-static', 'storybook/bin/index.cjs', [
  'build',
  '--config-dir',
  path.join(core, '.storybook'),
  '--output-dir',
  path.join(cwd, '.out'),
]);
for (const file of ['.out/index.html', '.out/iframe.html', '.out/index.json'])
  assert.ok(
    fs.existsSync(path.join(cwd, file)),
    `Missing Storybook output ${file}`,
  );
const index = JSON.parse(fs.readFileSync(path.join(cwd, '.out/index.json')));
assert.ok(
  Object.values(index.entries).some(
    (entry) => entry.title === 'Components/Button',
  ),
);
console.log(
  JSON.stringify(
    {
      platform: process.platform,
      node: process.version,
      consumer: cwd,
      productionWebpack: 'passed',
      staticStorybook: 'passed',
    },
    null,
    2,
  ),
);
