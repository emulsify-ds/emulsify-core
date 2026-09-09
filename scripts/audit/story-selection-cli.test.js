/**
 * @file Executable audit coverage for CSF export selection and inherited renders.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { makeTempProject, removeTempProject, writeFile } from './test-utils.js';

const require = createRequire(import.meta.url);
const corePackage = require('../../package.json');
const twigImport = 'import cardTwig from "./card.twig";';
const renderImport = 'import { renderTwig } from "@emulsify/core/storybook";';
const cases = [
  {
    name: 'selects lowercase legacy exports by default',
    lines: [
      twigImport,
      'export default { title: "Card" };',
      'export const primary = (args) => cardTwig(args);',
    ],
    findingLine: 3,
  },
  {
    name: 'selects lowercase exports through an include array',
    lines: [
      twigImport,
      renderImport,
      'export default { title: "Card", includeStories: ["primary"] };',
      'export const SourceHelper = (args) => cardTwig(args);',
      'export const primary = (args) => cardTwig(args);',
    ],
    findingLine: 5,
  },
  {
    name: 'omits uppercase helpers through an exclude array',
    lines: [
      twigImport,
      renderImport,
      'export default { title: "Card", render: renderTwig(cardTwig), excludeStories: ["SourceHelper"] };',
      'export const SourceHelper = (args) => cardTwig(args);',
      'export const primary = {};',
    ],
    findingLine: null,
  },
  {
    name: 'omits uppercase helpers through an include regex',
    lines: [
      twigImport,
      renderImport,
      'export default { title: "Card", render: renderTwig(cardTwig), includeStories: /^primary$/ };',
      'export const SourceHelper = (args) => cardTwig(args);',
      'export const primary = {};',
    ],
    findingLine: null,
  },
  {
    name: 'selects lowercase legacy stories through an exclude regex',
    lines: [
      twigImport,
      renderImport,
      'export default { title: "Card", excludeStories: /Helper$/ };',
      'export const SourceHelper = (args) => cardTwig(args);',
      'export const primary = (args) => cardTwig(args);',
    ],
    findingLine: 5,
  },
  {
    name: 'inherits a legacy default render for a selected lowercase story',
    lines: [
      twigImport,
      renderImport,
      'export default { title: "Card", render: (args) => cardTwig(args) };',
      'export const primary = {};',
    ],
    findingLine: 3,
  },
  {
    name: 'lets a selected modern render override a legacy default',
    lines: [
      twigImport,
      renderImport,
      'export default { title: "Card", render: (args) => cardTwig(args) };',
      'export const primary = { render: renderTwig(cardTwig) };',
    ],
    findingLine: null,
  },
  {
    name: 'reports a selected legacy override of a modern default',
    lines: [
      twigImport,
      renderImport,
      'export default { title: "Card", render: renderTwig(cardTwig) };',
      'export const primary = { render: (args) => cardTwig(args) };',
    ],
    findingLine: 4,
  },
  {
    name: 'ignores a legacy default when no exports are selected',
    lines: [
      twigImport,
      'export default { title: "Card", render: (args) => cardTwig(args), includeStories: [] };',
      'export const Primary = {};',
    ],
    findingLine: null,
  },
  {
    name: 'does not treat default metadata alone as a story',
    lines: [
      twigImport,
      'export default { title: "Card", render: (args) => cardTwig(args) };',
    ],
    findingLine: null,
  },
  {
    name: 'resolves aliased metadata wrapped in TypeScript satisfies',
    extension: 'ts',
    lines: [
      twigImport,
      renderImport,
      'import type { Meta } from "@storybook/react";',
      'const sourceMeta = { title: "Card", includeStories: ["primary"], render: renderTwig(cardTwig) } satisfies Meta;',
      'const meta = sourceMeta;',
      'export default meta;',
      'export const SourceHelper = (args) => cardTwig(args);',
      'export const primary = {};',
    ],
    findingLine: null,
  },
];

describe.each([
  { script: 'scripts/audit.js', twigFiles: 1 },
  { script: 'scripts/audit-twig-stories.js', twigFiles: 0 },
])('CSF selection through $script', ({ script, twigFiles }) => {
  let projectDir;

  beforeEach(() => {
    projectDir = makeTempProject();
    writeFile(
      projectDir,
      'project.emulsify.json',
      JSON.stringify({
        project: {
          platform: 'none',
          name: 'Story selection fixture',
          machineName: 'story_selection_fixture',
        },
      }),
    );
    writeFile(
      projectDir,
      'src/components/card/card.twig',
      '<p>{{ title }}</p>',
    );
  });

  afterEach(() => {
    removeTempProject(projectDir);
  });

  const audit = (extraArgs = []) =>
    spawnSync(
      process.execPath,
      [
        join(process.cwd(), script),
        '--root',
        projectDir,
        '--json',
        ...extraArgs,
      ],
      { encoding: 'utf8', timeout: 10000 },
    );

  const expectReport = (result, findings) => {
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({
      schemaVersion: 1,
      tool: { name: corePackage.name, version: corePackage.version },
      root: '.',
      summary: { error: 0, warn: findings.length, info: 0 },
      files: { stories: 1, twig: twigFiles, code: 1, styles: 0 },
      findings,
    });
    expect(result.stdout).not.toContain(projectDir);
  };

  const legacyFinding = (path, line, hasRenderTwig) => ({
    id: 'legacy-twig-story',
    severity: 'warn',
    path,
    line,
    message:
      'Twig story appears to return an HTML string directly. This remains compatible, but renderTwig() is preferred for active migrations.',
    details: [
      ...(hasRenderTwig ? [] : ['imports Twig templates without renderTwig()']),
      'appears to return Twig HTML strings directly',
    ],
    docs: 'https://github.com/emulsify-ds/emulsify-core/blob/4.x/docs/storybook.md#legacy-twig-story-compatibility',
  });

  it.each(cases)('$name', ({ lines, findingLine, extension = 'js' }) => {
    const storyPath = `src/components/card/card.stories.${extension}`;
    writeFile(projectDir, storyPath, lines.join('\n'));
    const findings = findingLine
      ? [legacyFinding(storyPath, findingLine, lines.includes(renderImport))]
      : [];

    const result = audit();
    expect(result.status).toBe(0);
    expectReport(result, findings);

    const failingOnFound = audit(['--fail-on-found']);
    expect(failingOnFound.status).toBe(findings.length);
    expectReport(failingOnFound, findings);
  });

  it('never executes a dynamic metadata factory and conservatively checks its exports', () => {
    const markerPath = join(projectDir, 'metadata-factory-executed');
    const storyPath = 'src/components/card/card.stories.js';
    writeFile(
      projectDir,
      storyPath,
      [
        twigImport,
        'import { writeFileSync } from "node:fs";',
        'function makeMeta() {',
        `  writeFileSync(${JSON.stringify(markerPath)}, "executed");`,
        '  throw new Error("Metadata must never execute during audit");',
        '}',
        'export default makeMeta();',
        'export const primary = (args) => cardTwig(args);',
      ].join('\n'),
    );
    const findings = [legacyFinding(storyPath, 8, false)];

    const result = audit();
    expect(result.status).toBe(0);
    expectReport(result, findings);
    expect(existsSync(markerPath)).toBe(false);

    const failingOnFound = audit(['--fail-on-found']);
    expect(failingOnFound.status).toBe(1);
    expectReport(failingOnFound, findings);
    expect(existsSync(markerPath)).toBe(false);
  });
});
