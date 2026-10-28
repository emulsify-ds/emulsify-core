/** @jest-environment node */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sass from 'sass';
import globImporter from '../config/webpack/sass-glob-importer.js';

let fixture;
function write(name, contents) {
  const file = path.join(fixture, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  return file;
}
function compile(contents, includePaths = []) {
  return sass
    .renderSync({
      file: write('main.scss', contents),
      includePaths,
      importer: globImporter(),
      outputStyle: 'compressed',
    })
    .css.toString();
}
beforeEach(() => {
  fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'emulsify-sass-globs-'));
});
afterEach(() => {
  fs.rmSync(fixture, { recursive: true, force: true });
});

test('preserves relative partials and nested glob imports', () => {
  write('tokens/_colors.scss', '$color: red;');
  write(
    'components/_first.scss',
    '@import "../tokens/colors"; .first { color: $color; }',
  );
  write('components/nested/_second.scss', '.second { color: blue; }');
  expect(compile('@import "components/**/*.scss";')).toBe(
    '.first{color:red}.second{color:blue}',
  );
});

test('accumulates matches across includePaths and removes duplicates', () => {
  write('components/_local.scss', '.local { color: red; }');
  write('a/components/_a.scss', '.a { color: green; }');
  write('b/components/_b.scss', '.b { color: blue; }');
  expect(
    compile('@import "components/*.scss";', [
      path.join(fixture, 'a'),
      path.join(fixture, 'b'),
      path.join(fixture, 'a'),
      fixture,
    ]),
  ).toBe('.local{color:red}.a{color:green}.b{color:blue}');
});

test('preserves directory index imports and CSS files matched by extensionless globs', () => {
  write('components/button/_index.scss', '.button { color: red; }');
  write('components/reset.css', 'body { margin: 0; }');
  const css = compile('@import "components/*";');
  expect(css).toContain('.button{color:red}');
  expect(css).toContain(
    `@import"${path.join(fixture, 'components/reset.css')}"`,
  );
});

test('allows missing glob directories and leaves plain imports to Sass', () => {
  write('_tokens.scss', '$color: red;');
  expect(
    compile(
      '@import "absent/**/*.scss"; @import "tokens"; .plain { color: $color; }',
    ),
  ).toBe('.plain{color:red}');
});

test('expands brace patterns without another wildcard', () => {
  write('parts/_first.scss', '.first { color: red; }');
  write('parts/_second.scss', '.second { color: blue; }');
  expect(compile('@import "parts/{_first,_second}.scss";')).toBe(
    '.first{color:red}.second{color:blue}',
  );
});
