/**
 * @file Vite plugin that loads built Storybook CSS as stylesheet links.
 */

import fs from 'fs';
import path from 'path';

export const storybookCssVirtualModuleIds = [
  'virtual:emulsify-storybook-css/dist',
  'virtual:emulsify-storybook-css/shared-dist',
];

const storybookCssResolvedVirtualModuleIds = new Map(
  storybookCssVirtualModuleIds.map((id) => [id, `\0${id}`]),
);

function isWithinDirectory(filePath, directory) {
  const relativePath = path.relative(
    comparablePath(directory),
    comparablePath(filePath),
  );
  return Boolean(
    relativePath &&
    !relativePath.startsWith('..') &&
    !path.isAbsolute(relativePath),
  );
}

function comparablePath(filePath) {
  try {
    return fs.realpathSync.native(filePath);
  } catch {
    const directory = path.dirname(filePath);

    try {
      return path.join(
        fs.realpathSync.native(directory),
        path.basename(filePath),
      );
    } catch {
      return path.resolve(filePath);
    }
  }
}

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function walkCssFiles(directory) {
  if (!fs.existsSync(directory)) return [];

  const files = [];
  const entries = fs
    .readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkCssFiles(entryPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.css')) {
      files.push(entryPath);
    }
  }

  return files;
}

function buildDistStylesheetHrefs(
  projectRoot,
  { includeComponentCss = true } = {},
) {
  const distDir = path.resolve(projectRoot, 'dist');
  const distComponentsDir = path.resolve(distDir, 'components');

  return walkCssFiles(distDir)
    .filter(
      (filePath) =>
        includeComponentCss || !isWithinDirectory(filePath, distComponentsDir),
    )
    .map((filePath) => toPosixPath(path.relative(projectRoot, filePath)));
}

function generateStylesheetLinkModule(hrefs, sourceName) {
  return `
export const stylesheetHrefs = ${JSON.stringify(hrefs)};
const sourceName = ${JSON.stringify(sourceName)};
const baseUrl = (import.meta.env.BASE_URL || '/').replace(/\\/?$/, '/');

function baseHref(stylesheetHref) {
  return \`\${baseUrl}\${String(stylesheetHref).replace(/^\\/+/, '')}\`;
}

function timestampHref(href, timestamp) {
  if (!timestamp) return href;
  return \`\${href}\${href.includes('?') ? '&' : '?'}t=\${timestamp}\`;
}

function sourceLinks() {
  return Array.from(
    document.querySelectorAll(
      \`link[data-emulsify-storybook-css="\${sourceName}"]\`,
    ),
  );
}

function appendStylesheet(href, stableHref) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.emulsifyStorybookCss = sourceName;
    link.dataset.emulsifyStorybookCssHref = stableHref;
    document.head.appendChild(link);
}

function replaceStylesheet(link, href, stableHref) {
  if (link.getAttribute('href') === href) return;

  const nextLink = link.cloneNode();
  nextLink.href = href;
  nextLink.dataset.emulsifyStorybookCss = sourceName;
  nextLink.dataset.emulsifyStorybookCssHref = stableHref;
  const removeOldLink = () => link.remove();
  nextLink.addEventListener('load', removeOldLink);
  nextLink.addEventListener('error', removeOldLink);
  link.after(nextLink);
}

function loadStylesheets(nextStylesheetHrefs = stylesheetHrefs, timestamp) {
  const stableHrefs = new Set(nextStylesheetHrefs.map(baseHref));

  for (const link of sourceLinks()) {
    if (!stableHrefs.has(link.dataset.emulsifyStorybookCssHref)) {
      link.remove();
    }
  }

  for (const stylesheetHref of nextStylesheetHrefs) {
    const stableHref = baseHref(stylesheetHref);
    const href = timestampHref(stableHref, timestamp);
    const existingLink = sourceLinks().find(
      (link) => link.dataset.emulsifyStorybookCssHref === stableHref,
    );

    if (existingLink) {
      replaceStylesheet(existingLink, href, stableHref);
    } else {
      appendStylesheet(href, stableHref);
    }
  }
}

if (typeof document !== 'undefined') {
  loadStylesheets();

  if (import.meta.hot) {
    import.meta.hot.on('emulsify-storybook-css-update', (event) => {
      if (event?.sourceName !== sourceName) return;

      loadStylesheets(
        event.stylesheetHrefs || stylesheetHrefs,
        event.timestamp || Date.now(),
      );
    });
  }
}
`;
}

function contentTypeForFile(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const types = {
    '.css': 'text/css; charset=utf-8',
    '.gif': 'image/gif',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml; charset=utf-8',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  };

  return types[extension] || 'application/octet-stream';
}

function makeGeneratedDistFileMiddleware(projectRoot) {
  return function serveGeneratedDistFile(req, res, next) {
    const method = req.method || 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      next();
      return;
    }

    let pathname = '';
    try {
      pathname = decodeURIComponent(
        new URL(req.url || '/', 'http://localhost').pathname,
      );
    } catch {
      next();
      return;
    }

    const routes = [
      {
        pathname: '/icons.svg',
        file: path.resolve(projectRoot, 'dist/assets/icons.svg'),
      },
      {
        prefix: '/assets/',
        directory: path.resolve(projectRoot, 'dist/assets'),
      },
      {
        prefix: '/dist/',
        directory: path.resolve(projectRoot, 'dist'),
      },
    ];
    const route = routes.find(({ prefix, pathname: routePathname }) =>
      routePathname ? pathname === routePathname : pathname.startsWith(prefix),
    );
    if (!route) {
      next();
      return;
    }

    const filePath = route.file
      ? route.file
      : path.resolve(route.directory, pathname.slice(route.prefix.length));
    if (route.directory && !isWithinDirectory(filePath, route.directory)) {
      next();
      return;
    }

    try {
      const stats = fs.statSync(filePath);
      if (!stats.isFile()) {
        next();
        return;
      }

      res.statusCode = 200;
      res.setHeader('Content-Type', contentTypeForFile(filePath));
      res.setHeader('Content-Length', stats.size);
      if (method === 'HEAD') {
        res.end();
        return;
      }
      res.end(fs.readFileSync(filePath));
    } catch {
      next();
    }
  };
}

/**
 * Create the Storybook CSS link plugin for the active project root.
 *
 * The plugin keeps built CSS out of Vite's CSS module pipeline, serves newly
 * generated dist assets during dev, and reloads when those files change.
 *
 * @param {{ projectRoot?: string }} [options] Plugin options.
 * @returns {import('vite').Plugin} Vite plugin.
 */
export function makeStorybookCssLinksPlugin({
  projectRoot = process.cwd(),
} = {}) {
  return {
    name: 'emulsify-storybook-css-links',
    resolveId(id) {
      return storybookCssResolvedVirtualModuleIds.get(id) || null;
    },
    load(id) {
      if (
        id ===
        storybookCssResolvedVirtualModuleIds.get(
          'virtual:emulsify-storybook-css/dist',
        )
      ) {
        return generateStylesheetLinkModule(
          buildDistStylesheetHrefs(projectRoot),
          'dist',
        );
      }

      if (
        id ===
        storybookCssResolvedVirtualModuleIds.get(
          'virtual:emulsify-storybook-css/shared-dist',
        )
      ) {
        return generateStylesheetLinkModule(
          buildDistStylesheetHrefs(projectRoot, {
            includeComponentCss: false,
          }),
          'shared-dist',
        );
      }

      return null;
    },
    configureServer(server) {
      const distDir = path.resolve(projectRoot, 'dist');
      const distAssetsDir = path.resolve(distDir, 'assets');

      server.middlewares.use(makeGeneratedDistFileMiddleware(projectRoot));
      server.watcher.add([
        path.join(distDir, '**/*.css'),
        path.join(distAssetsDir, '**/*'),
      ]);

      const sendCssUpdate = () => {
        const timestamp = Date.now();
        server.ws.send({
          type: 'custom',
          event: 'emulsify-storybook-css-update',
          data: {
            sourceName: 'dist',
            stylesheetHrefs: buildDistStylesheetHrefs(projectRoot),
            timestamp,
          },
        });
        server.ws.send({
          type: 'custom',
          event: 'emulsify-storybook-css-update',
          data: {
            sourceName: 'shared-dist',
            stylesheetHrefs: buildDistStylesheetHrefs(projectRoot, {
              includeComponentCss: false,
            }),
            timestamp,
          },
        });
      };

      const reloadGeneratedDistFile = (filePath) => {
        const absolutePath = path.resolve(filePath);
        const isDistCss =
          absolutePath.endsWith('.css') &&
          isWithinDirectory(absolutePath, distDir);
        const isDistAsset = isWithinDirectory(absolutePath, distAssetsDir);

        if (!isDistCss && !isDistAsset) {
          return;
        }

        if (isDistCss) {
          sendCssUpdate();
          return;
        }

        server.ws.send({ type: 'full-reload', path: '*' });
      };

      server.watcher.on('add', reloadGeneratedDistFile);
      server.watcher.on('change', reloadGeneratedDistFile);
      server.watcher.on('unlink', reloadGeneratedDistFile);
    },
  };
}
