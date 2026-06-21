/**
 * @file Tests for shared Storybook preview wiring.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

function readPreviewSource() {
  return readFileSync(
    fileURLToPath(new URL('./preview.js', import.meta.url)),
    'utf8',
  );
}

describe('Storybook preview decorators', () => {
  it('passes the full Storybook context through the bound Story function', () => {
    /**
     * Keep this source-level regression test narrow: it only guards the
     * decorator boundary that previously dropped non-args context fields such
     * as globals, parameters, loaded, id, and name.
     */
    const source = readPreviewSource();

    expect(source).toMatch(/\(Story,\s*context\)\s*=>/);
    expect(source).toMatch(/renderHtmlStoryResult\(Story\(context\),/);
    expect(source).not.toMatch(/Story\(\{\s*args\s*\}\)/);
    expect(source).not.toContain('StoryHtmlBoundary');
  });

  it('keeps behavior attachment keyed to args updates', () => {
    const source = readPreviewSource();

    expect(source).toMatch(/const \{\s*args\s*\} = context;/);
    expect(source).toMatch(/useEffect\([\s\S]*\}, \[args\]\);/);
  });
});
