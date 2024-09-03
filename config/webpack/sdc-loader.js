module.exports = function (source) {
  const projectName = this.getOptions().projectName || '';
  const result = source.replace(
    new RegExp(`${projectName}:`, 'g'),
    `${projectName}/`,
  );
  return result;
};
