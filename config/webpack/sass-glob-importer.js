import { delimiter, dirname, isAbsolute, resolve } from 'node:path';
import { globSync, hasMagic } from 'glob';

// Preserve the 3.x legacy Sass importer contract with the supported glob API.
export default function globImporter() {
  return function (url, previous) {
    if (!hasMagic(url, { magicalBraces: true })) return null;
    const roots = [
      ...(isAbsolute(previous) ? [dirname(previous)] : []),
      ...(this.options.includePaths || '').split(delimiter),
    ];
    const files = new Set();
    for (const root of roots) {
      for (const file of globSync(url, { cwd: root }).sort((a, b) =>
        a.localeCompare(b, 'en'),
      )) {
        files.add(resolve(root, file));
      }
    }
    return {
      contents: [...files]
        .map((file) => `@import ${JSON.stringify(file.replaceAll('\\', '/'))};`)
        .join('\n'),
    };
  };
}
