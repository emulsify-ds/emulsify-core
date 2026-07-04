/**
 * @file Browser-safe root-relative path helpers shared by Vite and Storybook.
 */

const normalizeProjectPath = (filePath) => {
  const normalized = String(filePath || '')
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/');

  return normalized === '/' ? normalized : normalized.replace(/\/+$/, '');
};

/**
 * Convert an absolute project path to a Vite root-relative key.
 *
 * @param {string} projectDir - Absolute project root.
 * @param {string} absolutePath - Absolute file or directory path.
 * @returns {string} Root-relative path with a leading slash.
 */
export function toRootRelativePath(projectDir, absolutePath) {
  if (!absolutePath) return '';

  const normalizedProjectDir = normalizeProjectPath(projectDir);
  const normalizedPath = normalizeProjectPath(absolutePath);

  if (normalizedProjectDir && normalizedPath === normalizedProjectDir) {
    return '/';
  }

  if (
    normalizedProjectDir &&
    normalizedPath.startsWith(`${normalizedProjectDir}/`)
  ) {
    return `/${normalizedPath.slice(normalizedProjectDir.length + 1)}`;
  }

  return `/${normalizedPath.replace(/^\/+/, '')}`;
}
