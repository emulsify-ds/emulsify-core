/**
 * @file Babel plugin for rewriting Vite import.meta helpers during Jest transforms.
 */

import { pathToFileURL } from 'url';

const transformImportMetaUrl = ({ types: t }) => ({
  visitor: {
    MemberExpression(path, state) {
      const { node } = path;
      const isImportMeta =
        node.object.type === 'MetaProperty' &&
        node.object.meta.name === 'import' &&
        node.object.property.name === 'meta';

      if (
        isImportMeta &&
        node.property.type === 'Identifier' &&
        node.property.name === 'url'
      ) {
        path.replaceWith(
          t.stringLiteral(pathToFileURL(state.file.opts.filename).href),
        );
      }

      if (
        isImportMeta &&
        node.property.type === 'Identifier' &&
        node.property.name === 'glob'
      ) {
        path.replaceWith(
          t.logicalExpression(
            '||',
            t.memberExpression(
              t.identifier('globalThis'),
              t.identifier('__viteImportMetaGlob'),
            ),
            t.arrowFunctionExpression([], t.objectExpression([])),
          ),
        );
      }
    },
  },
});

export default transformImportMetaUrl;
