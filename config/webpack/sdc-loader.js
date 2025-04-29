/**
 * A loader function that replaces occurrences of "projectName:" with "projectName/".
 *
 * @param {string} source - The source string to process.
 * @returns {string} The transformed source.
 */
export default function (source) {
  const projectName = this.getOptions().projectName || '';
  const result = source.replace(
    new RegExp(`${projectName}:`, 'g'),
    `${projectName}/`,
  );
  return result;
}
