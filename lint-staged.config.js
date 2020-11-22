module.exports = {
  "*.{t,j}s": ["eslint --cache --fix", "jest --findRelatedTests"],
  "package.json": ["sort-package-json"],
};
