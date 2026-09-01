/**
 * Exact-path capability store for renderer file operations.
 *
 * A renderer should only be able to touch files the user selected in a native
 * dialog (or opened through an OS file association). Keeping this logic in a
 * small dependency-free module makes the security boundary easy to test.
 */

const path = require('node:path');

function normalize(candidate) {
  if (typeof candidate !== 'string' || !candidate.trim()) return null;
  return path.resolve(candidate);
}

function createFileAccess() {
  const grants = new Map();

  return {
    grant(candidate, { read = false, write = false } = {}) {
      const filePath = normalize(candidate);
      if (!filePath) throw new TypeError('A valid file path is required.');
      const current = grants.get(filePath) || { read: false, write: false };
      grants.set(filePath, {
        read: current.read || !!read,
        write: current.write || !!write,
      });
      return filePath;
    },

    canRead(candidate) {
      const filePath = normalize(candidate);
      return !!(filePath && grants.get(filePath)?.read);
    },

    canWrite(candidate) {
      const filePath = normalize(candidate);
      return !!(filePath && grants.get(filePath)?.write);
    },
  };
}

module.exports = { createFileAccess };
