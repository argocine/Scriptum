/** Crash-resistant, serialized writes for user documents and recovery data. */

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const queues = new Map();

async function atomicWriteFile(candidate, data, { encoding } = {}) {
  const target = path.resolve(candidate);
  const directory = path.dirname(target);
  const basename = path.basename(target);
  const temporary = path.join(
    directory,
    `.${basename}.${process.pid}.${crypto.randomUUID()}.tmp`
  );

  let mode = 0o600;
  try {
    const existing = await fs.stat(target);
    if (existing.isFile()) mode = existing.mode & 0o777;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  let handle = null;
  try {
    handle = await fs.open(temporary, 'wx', mode);
    await handle.writeFile(data, encoding ? { encoding } : undefined);
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporary, target);
  } finally {
    await handle?.close().catch(() => {});
    await fs.unlink(temporary).catch((error) => {
      if (error?.code !== 'ENOENT') console.warn('Could not remove temporary save file:', error);
    });
  }
}

/** Serialize writes to the same path so an older save can never land last. */
function enqueueAtomicWrite(candidate, data, options) {
  const target = path.resolve(candidate);
  const previous = queues.get(target) || Promise.resolve();
  const operation = previous.catch(() => {}).then(() => atomicWriteFile(target, data, options));
  queues.set(target, operation);
  operation.finally(() => {
    if (queues.get(target) === operation) queues.delete(target);
  }).catch(() => {});
  return operation;
}

module.exports = { atomicWriteFile, enqueueAtomicWrite };
