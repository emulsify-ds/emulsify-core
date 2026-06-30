import fs from 'fs';
import path from 'path';

const projectRoot = process.cwd();

/**
 * Keeps Storybook static directory config aligned to the consuming project.
 *
 * @param {Array<string|{from: string, to: string}>} staticDirs - Static directory entries.
 * @returns {Array<string|{from: string, to: string}>} Existing static directory entries.
 */
function existingStaticDirs(staticDirs) {
  const seen = new Set();
  const existing = [];

  for (const staticDir of staticDirs) {
    const directory =
      typeof staticDir === 'string' ? staticDir : staticDir.from;

    if (!directory || !fs.existsSync(directory)) continue;

    const key =
      typeof staticDir === 'string'
        ? staticDir
        : `${staticDir.from || ''}\0${staticDir.to || ''}`;
    if (seen.has(key)) continue;

    seen.add(key);
    existing.push(staticDir);
  }

  return existing;
}

/**
 * Build static directory mounts for normalized project asset roots.
 *
 * @param {object} env - Resolved project paths used by Storybook.
 * @returns {Array<string|{from: string, to: string}>} Static directory entries.
 */
export function buildAssetStaticDirs(env) {
  const configuredAssetRoots = Array.isArray(env.projectStructure?.assetRoots)
    ? env.projectStructure.assetRoots
    : [];
  const assetRoots = [
    ...configuredAssetRoots,
    path.resolve(projectRoot, 'assets'),
    path.resolve(projectRoot, 'src/assets'),
  ];

  return existingStaticDirs([
    ...assetRoots.map((root) => ({
      from: root,
      to: '/assets',
    })),
    {
      from: path.resolve(projectRoot, 'dist/assets'),
      to: '/assets',
    },
    {
      from: path.resolve(projectRoot, 'dist/assets'),
      to: '/',
    },
  ]);
}

/**
 * Checks whether a resolved file path stays inside an expected directory.
 *
 * @param {string} filePath - Resolved candidate file path.
 * @param {string} directory - Resolved directory that must contain the file.
 * @returns {boolean} Whether the file path is inside the directory.
 */
function isWithinDirectory(filePath, directory) {
  // `path.relative()` exposes traversal attempts as `..` or absolute paths.
  const relativePath = path.relative(directory, filePath);
  return Boolean(
    relativePath &&
    !relativePath.startsWith('..') &&
    !path.isAbsolute(relativePath),
  );
}

/**
 * Returns a browser content type for generated files served by Storybook.
 *
 * @param {string} filePath - Resolved file path being served.
 * @returns {string} HTTP content type header value.
 */
function contentTypeForFile(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  // Keep this map small; unknown generated files can still download as binary.
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

/**
 * Serves generated dist files that may not exist when `staticDirs` is built.
 *
 * Storybook validates static directories during config load, but Emulsify
 * projects often generate `dist` after Storybook starts. This middleware keeps
 * those generated asset URLs available without replacing Vite's CSS HMR.
 *
 * @param {import('http').IncomingMessage} req - Vite dev server request.
 * @param {import('http').ServerResponse} res - Vite dev server response.
 * @param {Function} next - Next middleware callback.
 * @returns {void}
 */
function serveGeneratedDistFile(req, res, next) {
  const method = req.method || 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    next();
    return;
  }

  let pathname = '';
  try {
    // Malformed URLs should fall through to Storybook's normal Vite server.
    pathname = decodeURIComponent(
      new URL(req.url || '/', 'http://localhost').pathname,
    );
  } catch {
    next();
    return;
  }

  // These URL shapes match Emulsify's compiled CSS and sprite references.
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
  // Resolve from known roots only, then reject traversal before reading.
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
    if (path.extname(filePath).toLowerCase() === '.css') {
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
}

/**
 * Adds Vite dev-server access to generated dist files.
 *
 * CSS itself is still imported through native `import.meta.glob()` calls in the
 * preview runtime; this plugin only fills the static-file gap for late-created
 * dist assets.
 *
 * @returns {import('vite').Plugin} Vite middleware plugin.
 */
export function makeGeneratedDistFilesPlugin() {
  return {
    name: 'emulsify-generated-dist-files',
    configureServer(server) {
      server.middlewares.use(serveGeneratedDistFile);
      // Watch generated assets so Vite notices files created after startup.
      server.watcher.add([
        path.join(projectRoot, 'dist/**/*.css'),
        path.join(projectRoot, 'dist/assets/**/*'),
      ]);
    },
  };
}
