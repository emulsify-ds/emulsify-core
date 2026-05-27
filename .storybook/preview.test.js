/**
 * @file Tests for shared Storybook preview wiring.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

describe('Storybook preview decorators', () => {
  it('passes current args through the bound Story function', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./preview.js', import.meta.url)),
      'utf8',
    );

    expect(source).toMatch(/renderHtmlStoryResult\(Story\(\{\s*args\s*\}\),/);
    expect(source).not.toContain('StoryHtmlBoundary');
  });
});
