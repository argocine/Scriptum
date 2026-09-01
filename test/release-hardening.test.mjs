import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { SaveCoordinator } from '../src/core/save-coordinator.js';

const require = createRequire(import.meta.url);
const { enqueueAtomicWrite } = require('../electron/atomic-write.cjs');
const { openPathFromArguments } = require('../electron/open-path.cjs');

let pass = 0;
async function t(name, fn) {
  await fn();
  pass += 1;
  console.log(`  ok  ${name}`);
}

console.log('\nRelease hardening');

await t('atomic writes replace a document without leaving temporary files', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'scriptum-atomic-'));
  const target = path.join(directory, 'draft.scriptum');
  try {
    await fs.writeFile(target, 'old', { mode: 0o640 });
    await enqueueAtomicWrite(target, 'new', { encoding: 'utf8' });
    assert.equal(await fs.readFile(target, 'utf8'), 'new');
    if (process.platform !== 'win32') {
      assert.equal((await fs.stat(target)).mode & 0o777, 0o640);
    }
    assert.deepEqual(await fs.readdir(directory), ['draft.scriptum']);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

await t('writes to one path are serialized in command order', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'scriptum-queue-'));
  const target = path.join(directory, 'draft.scriptum');
  try {
    await Promise.all([
      enqueueAtomicWrite(target, 'first', { encoding: 'utf8' }),
      enqueueAtomicWrite(target, 'second', { encoding: 'utf8' }),
    ]);
    assert.equal(await fs.readFile(target, 'utf8'), 'second');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

await t('an older save cannot mark a newer document revision clean', async () => {
  const coordinator = new SaveCoordinator();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let began;
  const started = new Promise((resolve) => { began = resolve; });
  const first = coordinator.enqueue(async (revision) => {
    began();
    await gate;
    return coordinator.isCurrent(revision);
  });
  await started;
  coordinator.noteMutation();
  release();
  assert.equal(await first, false);
  assert.equal(await coordinator.enqueue(async (revision) => coordinator.isCurrent(revision)), true);
});

await t('file-association arguments accept only supported screenplay paths', () => {
  assert.equal(openPathFromArguments(['--flag', '/tmp/Draft.SCRIPTUM']), path.resolve('/tmp/Draft.SCRIPTUM'));
  assert.equal(openPathFromArguments(['/tmp/readme.md', '/tmp/story.fountain']), path.resolve('/tmp/story.fountain'));
  assert.equal(openPathFromArguments(['--dev', '/tmp/malware.app']), null);
});

console.log(`\n${pass} release-hardening checks passed.`);
