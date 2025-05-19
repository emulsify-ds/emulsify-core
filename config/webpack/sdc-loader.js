/**
 * A loader function that replaces occurrences of "projectName:" with "projectName/".
 *
 * @param {string} source - The source string to process.
 * @returns {string} The transformed source.
 */
export default function (source) {
  const projectName = this.getOptions().projectName || '';
  /* eslint-disable security/detect-non-literal-regexp */
  const result = source.replace(
    new RegExp(`${projectName}:`, 'g'),
    `${projectName}/`,
  );
  /* eslint-enable security/detect-non-literal-regexp */
  return result;
}
