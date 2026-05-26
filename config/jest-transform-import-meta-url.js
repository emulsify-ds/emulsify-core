/**
 * @file Babel plugin for rewriting import.meta.url during Jest transforms.
 */

import { pathToFileURL } from 'url';

const transformImportMetaUrl = ({ types: t }) => ({
  visitor: {
    MemberExpression(path, state) {
      const { node } = path;
      if (
        node.object.type === 'MetaProperty' &&
        node.object.meta.name === 'import' &&
        node.object.property.name === 'meta' &&
        node.property.type === 'Identifier' &&
        node.property.name === 'url'
      ) {
        path.replaceWith(
          t.stringLiteral(pathToFileURL(state.file.opts.filename).href),
        );
      }
    },
  },
});

export default transformImportMetaUrl;
