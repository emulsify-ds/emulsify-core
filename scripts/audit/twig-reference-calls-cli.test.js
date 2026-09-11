/**
 * @file Combined audit CLI regressions for complete Twig include/source calls.
 */

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { makeTempProject, removeTempProject, writeFile } from './test-utils.js';

const require = createRequire(import.meta.url);
const corePackage = require('../../package.json');
const auditScript = join(process.cwd(), 'scripts/audit.js');
const existing = '@components/probe/existing.twig';
const missing = '@components/probe/missing.twig';
const otherMissing = '@components/probe/other-missing.twig';
const probePath = 'src/components/probe/probe.twig';
const cases = [
  {
    name: 'accepts a fallback array when a later template exists',
    source: `{{ include(['${missing}', '${existing}']) }}`,
    findings: [],
  },
  {
    name: 'reports one call when every static fallback is missing',
    source: `{{ include(['${missing}', '${otherMissing}']) }}`,
    findings: [
      { type: 'include', line: 1, candidates: [missing, otherMissing] },
    ],
  },
  {
    name: 'accepts an optional missing source',
    source: `{{ source('${missing}', true) }}`,
    findings: [],
  },
  {
    name: 'does not count an empty fallback string as a resolved template',
    source: `{{ include(['${missing}', '']) }}`,
    findings: [{ type: 'include', line: 1, candidates: [missing, ''] }],
  },
  {
    name: 'keeps an uppercase FALSE source flag required',
    source: `{{ source('${missing}', FALSE) }}`,
    findings: [{ type: 'source', line: 1, candidates: [missing] }],
  },
  {
    name: 'honors the first duplicate optional flag as Twig.js does',
    source: `{{ include('${missing}', { ignore_missing: true, ignore_missing: false }) }}`,
    findings: [],
  },
  {
    name: 'honors the first duplicate required flag as Twig.js does',
    source: `{{ include('${missing}', { ignore_missing: false, ignore_missing: true }) }}`,
    findings: [{ type: 'include', line: 1, candidates: [missing] }],
  },
  {
    name: 'reports a required missing source',
    source: `{{ source('${missing}') }}`,
    findings: [{ type: 'source', line: 1, candidates: [missing] }],
  },
  {
    name: 'reports an explicitly required missing include',
    source: `{{ include('${missing}', {}, false, false) }}`,
    findings: [{ type: 'include', line: 1, candidates: [missing] }],
  },
  {
    name: 'accepts the positional include ignore-missing option',
    source: `{{ include('${missing}', {}, false, true) }}`,
    findings: [],
  },
  {
    name: 'accepts include options in the second object argument',
    source: `{{ include('${missing}', { ignore_missing: true }) }}`,
    findings: [],
  },
  {
    name: 'accepts include options in the third object argument',
    source: `{{ include('${missing}', {}, { ignore_missing: true }) }}`,
    findings: [],
  },
  {
    name: 'keeps false in an include options object required',
    source: `{{ include('${missing}', { ignore_missing: false }) }}`,
    findings: [{ type: 'include', line: 1, candidates: [missing] }],
  },
  {
    name: 'does not treat an ordinary context object as ignore-missing',
    source: `{{ include('${missing}', { label: '${otherMissing}' }) }}`,
    findings: [{ type: 'include', line: 1, candidates: [missing] }],
  },
  {
    name: 'ignores context strings and call-like text inside literals',
    source: `{{ include('${existing}', { label: '${missing}', snippet: "source('${otherMissing}')", nested: { punctuation: 'a,b)' } }) }}`,
    findings: [],
  },
  {
    name: 'does not declare a mixed static and dynamic fallback unresolved',
    source: `{{ include(['${missing}', chosen_template]) }}`,
    findings: [],
  },
  {
    name: 'does not declare a source with dynamic optionality unresolved',
    source: `{{ source('${missing}', allow_missing) }}`,
    findings: [],
  },
  {
    name: 'does not declare an include with dynamic optionality unresolved',
    source: `{{ include('${missing}', {}, false, allow_missing) }}`,
    findings: [],
  },
  {
    name: 'does not interpret unsupported fully named include arguments',
    source: `{{ include(template: '${missing}', ignore_missing: false) }}`,
    findings: [],
  },
  {
    name: 'does not interpret unsupported trailing named include arguments',
    source: `{{ include('${missing}', {}, with_context: false, ignore_missing: true) }}`,
    findings: [],
  },
  {
    name: 'does not interpret unsupported trailing named source arguments',
    source: `{{ source('${missing}', ignore_missing: false) }}`,
    findings: [],
  },
  {
    name: 'does not interpret unsupported equals-style named arguments',
    source: `{{ source(name = '${missing}', ignore_missing = false) }}`,
    findings: [],
  },
  {
    name: 'ignores comments and locates a multiline fallback at its call',
    source: [
      '{#',
      `  {{ source('${missing}') }}`,
      '#}',
      '{{ include(',
      '  [',
      `    '${missing}',`,
      `    '${otherMissing}'`,
      '  ],',
      `  { label: '${missing}' }`,
      ') }}',
    ].join('\n'),
    findings: [
      { type: 'include', line: 4, candidates: [missing, otherMissing] },
    ],
  },
  {
    name: 'keeps two required calls on the same line as two findings',
    source: `{{ include('${missing}') }} {{ source('${otherMissing}', false) }}`,
    findings: [
      { type: 'include', line: 1, candidates: [missing] },
      { type: 'source', line: 1, candidates: [otherMissing] },
    ],
  },
];

describe('Twig reference calls through the combined audit executable', () => {
  let projectDir;

  beforeEach(() => {
    projectDir = makeTempProject();
    writeFile(
      projectDir,
      'project.emulsify.json',
      JSON.stringify({
        project: {
          platform: 'none',
          name: 'Twig reference call fixture',
          machineName: 'twig_reference_call_fixture',
        },
      }),
    );
    writeFile(
      projectDir,
      'src/components/probe/existing.twig',
      '<p>Existing fallback</p>',
    );
  });

  afterEach(() => {
    removeTempProject(projectDir);
  });

  const audit = (extraArgs = []) =>
    spawnSync(
      process.execPath,
      [auditScript, '--root', projectDir, '--json', ...extraArgs],
      { encoding: 'utf8', timeout: 10000 },
    );

  const expectReport = (result, expectedFindings) => {
    expect(result.stderr).toBe('');
    const parsed = JSON.parse(result.stdout);
    expect(Object.keys(parsed)).toEqual([
      'schemaVersion',
      'tool',
      'root',
      'summary',
      'files',
      'findings',
    ]);
    expect(parsed).toEqual({
      schemaVersion: 1,
      tool: { name: corePackage.name, version: corePackage.version },
      root: '.',
      summary: { error: 0, warn: expectedFindings.length, info: 0 },
      files: { stories: 0, twig: 2, code: 0, styles: 0 },
      findings: expectedFindings.map(({ type, line }) =>
        expect.objectContaining({
          id: 'unresolved-twig-reference',
          severity: 'warn',
          path: probePath,
          line,
          message: expect.stringContaining(`${type}()`),
          docs: 'https://github.com/emulsify-ds/emulsify-core/blob/4.x/docs/storybook.md#include',
        }),
      ),
    });
    expectedFindings.forEach(({ candidates }, index) => {
      for (const candidate of candidates) {
        expect(parsed.findings[index].message).toContain(candidate);
      }
      expect(parsed.findings[index]).not.toHaveProperty('filePath');
    });
    expect(result.stdout).not.toContain(projectDir);
  };

  it.each(cases)('$name', ({ source, findings }) => {
    writeFile(projectDir, probePath, source);

    const result = audit();
    expect(result.status).toBe(0);
    expectReport(result, findings);

    const failingOnWarnings = audit(['--fail-on', 'warn']);
    expect(failingOnWarnings.status).toBe(findings.length ? 1 : 0);
    expectReport(failingOnWarnings, findings);

    const failingOnErrors = audit(['--fail-on', 'error']);
    expect(failingOnErrors.status).toBe(0);
    expectReport(failingOnErrors, findings);
  });
});
