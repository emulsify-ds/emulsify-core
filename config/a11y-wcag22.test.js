import { createRequire } from 'node:module';
import axe from 'axe-core';
import wcag22 from './a11y-wcag22.js';

const require = createRequire(import.meta.url);
// Pa11y can install its own axe version independently of Core's root dependency.
const pa11yRequire = createRequire(require.resolve('pa11y/package.json'));
const pa11yAxe = pa11yRequire('axe-core');

describe('optional WCAG 2.2 preset', () => {
  it.each([
    ['Pa11y runner', pa11yAxe],
    ['Core root', axe],
  ])('covers the %s axe WCAG 2.2 A and AA rules', (_, runtimeAxe) => {
    const supportedRules = runtimeAxe
      .getRules(['wcag22a', 'wcag22aa'])
      .map(({ ruleId }) => ruleId)
      .sort();

    expect(supportedRules).toContain('target-size');
    expect([...wcag22.pa11y.rules].sort()).toEqual(supportedRules);
  });
});
