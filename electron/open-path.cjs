/** Pure helpers for safe operating-system file-association arguments. */

const path = require('node:path');

const SUPPORTED_EXTENSIONS = new Set(['.scriptum', '.fdx', '.fountain', '.spmd', '.txt']);

function openPathFromArguments(argv = []) {
  for (const candidate of argv) {
    if (typeof candidate !== 'string' || !candidate || candidate.startsWith('-')) continue;
    if (!SUPPORTED_EXTENSIONS.has(path.extname(candidate).toLowerCase())) continue;
    return path.resolve(candidate);
  }
  return null;
}

module.exports = { SUPPORTED_EXTENSIONS, openPathFromArguments };
