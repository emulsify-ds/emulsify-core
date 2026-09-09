/**
 * @file Guard the packed audit wrapper verifier against false passes.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { verifyCopiedAuditWrapper } from './verify-copied-audit-wrapper.js';

jest.mock('node:child_process', () => ({ spawnSync: jest.fn() }));

const scriptCases = [
  [
    'audit',
    ['--fail-on', 'warn'],
    'Audit docs: https://github.com/emulsify-ds/emulsify-core/blob/4.x/docs/migration-4x.md#storybook-migration',
  ],
  [
    'audit:twig-stories',
    ['--fail-on-found'],
    'Migration docs: https://github.com/emulsify-ds/emulsify-core/blob/4.x/docs/storybook.md#legacy-twig-story-compatibility',
  ],
];

const storyPath = 'src/components/card/card.stories.js';
const report = {
  schemaVersion: 1,
  tool: { name: '@emulsify/core', version: '4.5.0' },
  root: '.',
  summary: { error: 0, warn: 1, info: 0 },
  files: { stories: 1, twig: 1, code: 1, styles: 0 },
  findings: [{ id: 'legacy-twig-story', severity: 'warn', path: storyPath }],
};

describe.each(scriptCases)(
  'copied %s verifier',
  (scriptName, failArgs, footer) => {
    beforeEach(() => {
      jest.spyOn(console, 'log').mockImplementation(() => {});
      spawnSync.mockReset();
      spawnSync.mockImplementation((_command, args) => ({
        status: args.includes(failArgs[0]) ? 1 : 0,
        stdout: `${JSON.stringify(report)}\n`,
        stderr: `\n${footer}\n`,
      }));
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('checks each threshold once and forwards the quoted scan root intact', () => {
      const spawnResult = spawnSync.getMockImplementation();
      let checkedSource;
      spawnSync.mockImplementation((command, args, options) => {
        const root = args[args.indexOf('--root') + 1];
        checkedSource = readFileSync(join(root, storyPath), 'utf8');
        return spawnResult(command, args, options);
      });

      verifyCopiedAuditWrapper('/installed-consumer', scriptName);

      expect(spawnSync).toHaveBeenCalledTimes(2);
      const root = spawnSync.mock.calls[0][1][5];
      expect(root).toContain('emulsify audit "wrapper" root-');
      expect(checkedSource).toContain('export const Card');
      for (const [index, flags] of [[], failArgs].entries()) {
        expect(spawnSync).toHaveBeenNthCalledWith(
          index + 1,
          'npm',
          [
            'run',
            '--silent',
            scriptName,
            '--',
            '--root',
            root,
            '--json',
            ...flags,
          ],
          expect.objectContaining({
            cwd: '/installed-consumer',
            encoding: 'utf8',
          }),
        );
      }
      expect(existsSync(root)).toBe(false);
    });

    it('rejects the old footer on stdout even when stderr also has a footer', () => {
      spawnSync.mockReturnValue({
        status: 0,
        stdout: `${JSON.stringify(report)}\n${footer}\n`,
        stderr: `${footer}\n`,
      });

      expect(() =>
        verifyCopiedAuditWrapper('/installed-consumer', scriptName),
      ).toThrow(SyntaxError);
      expect(existsSync(spawnSync.mock.calls[0][1][5])).toBe(false);
    });

    it('rejects a footer command that masks the failing audit status', () => {
      spawnSync.mockReturnValue({
        status: 0,
        stdout: JSON.stringify(report),
        stderr: `${footer}\n`,
      });

      expect(() =>
        verifyCopiedAuditWrapper('/installed-consumer', scriptName),
      ).toThrow('incorrect exit status');
      expect(spawnSync).toHaveBeenCalledTimes(2);
    });

    it('rejects a CLI usage error instead of accepting any nonzero status', () => {
      spawnSync.mockReturnValueOnce({
        status: 0,
        stdout: JSON.stringify(report),
        stderr: `${footer}\n`,
      });
      spawnSync.mockReturnValueOnce({
        status: 2,
        stdout: '{}',
        stderr: 'Usage',
      });

      expect(() =>
        verifyCopiedAuditWrapper('/installed-consumer', scriptName),
      ).toThrow('incorrect exit status');
    });

    it('rejects removal of the documentation footer', () => {
      spawnSync.mockReturnValue({
        status: 0,
        stdout: JSON.stringify(report),
        stderr: '',
      });

      expect(() =>
        verifyCopiedAuditWrapper('/installed-consumer', scriptName),
      ).toThrow('omitted its expected stderr footer');
    });

    it('rejects a warning from a different root', () => {
      spawnSync.mockReturnValue({
        status: 0,
        stdout: JSON.stringify({
          ...report,
          findings: [{ ...report.findings[0], path: 'other/card.stories.js' }],
        }),
        stderr: `${footer}\n`,
      });

      expect(() =>
        verifyCopiedAuditWrapper('/installed-consumer', scriptName),
      ).toThrow('Expected only the controlled legacy story warning');
    });
  },
);
