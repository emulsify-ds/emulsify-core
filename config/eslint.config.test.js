/** @jest-environment node */

import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

it('ignores generated output while still linting authored components', () => {
  const project = realpathSync(
    mkdtempSync(path.join(tmpdir(), 'emulsify-lint-output-')),
  );
  const source = path.join(project, 'src/components/authored.js');
  const lint = () =>
    spawnSync(
      process.execPath,
      [
        path.join(__dirname, '../node_modules/eslint/bin/eslint.js'),
        '--config',
        path.join(__dirname, 'eslint.config.js'),
        '--format',
        'json',
        '.',
      ],
      { cwd: project, encoding: 'utf8' },
    );

  try {
    for (const directory of ['dist', '.out', '.coverage', 'components']) {
      mkdirSync(path.join(project, directory));
      writeFileSync(
        path.join(project, directory, 'generated.js'),
        'invalid = ;',
      );
    }
    mkdirSync(path.dirname(source), { recursive: true });
    writeFileSync(source, 'export default true;\n');

    const valid = lint();
    expect(valid.status).toBe(0);
    expect(JSON.parse(valid.stdout).map(({ filePath }) => filePath)).toEqual([
      source,
    ]);

    writeFileSync(source, 'invalid = ;');
    const invalid = lint();
    expect(invalid.status).toBe(1);
    expect(JSON.parse(invalid.stdout)[0].fatalErrorCount).toBe(1);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
