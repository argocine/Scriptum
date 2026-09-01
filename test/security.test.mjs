import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createFileAccess } = require('../electron/file-access.cjs');
const { isAllowedExternalUrl } = require('../electron/navigation-policy.cjs');

let pass = 0;
function t(name, fn) {
  fn();
  pass += 1;
  console.log(`  ok  ${name}`);
}

console.log('\nFile access boundary');

t('unselected paths have no access', () => {
  const access = createFileAccess();
  assert.equal(access.canRead('/tmp/unselected.scriptum'), false);
  assert.equal(access.canWrite('/tmp/unselected.scriptum'), false);
});

t('read and write capabilities are separate', () => {
  const access = createFileAccess();
  access.grant('/tmp/chosen.scriptum', { read: true });
  assert.equal(access.canRead('/tmp/chosen.scriptum'), true);
  assert.equal(access.canWrite('/tmp/chosen.scriptum'), false);
  access.grant('/tmp/chosen.scriptum', { write: true });
  assert.equal(access.canWrite('/tmp/chosen.scriptum'), true);
});

t('equivalent normalized paths share one grant', () => {
  const access = createFileAccess();
  const chosen = path.join('/tmp', 'scriptum', '..', 'chosen.scriptum');
  access.grant(chosen, { write: true });
  assert.equal(access.canWrite('/tmp/chosen.scriptum'), true);
});

t('a grant never covers a sibling path', () => {
  const access = createFileAccess();
  access.grant('/tmp/chosen.scriptum', { read: true, write: true });
  assert.equal(access.canRead('/tmp/chosen.scriptum.backup'), false);
  assert.equal(access.canWrite('/tmp/other.scriptum'), false);
});

t('invalid paths are rejected', () => {
  const access = createFileAccess();
  assert.throws(() => access.grant('', { read: true }), /valid file path/i);
  assert.throws(() => access.grant(null, { read: true }), /valid file path/i);
});

t('only the exact HTTPS help page may open outside the app', () => {
  assert.equal(isAllowedExternalUrl('https://fountain.io/syntax'), true);
  assert.equal(isAllowedExternalUrl('https://fountain.io/syntax/'), true);
  assert.equal(isAllowedExternalUrl('http://fountain.io/syntax'), false);
  assert.equal(isAllowedExternalUrl('https://fountain.io/syntax?screenplay=secret'), false);
  assert.equal(isAllowedExternalUrl('https://fountain.io.evil.test/syntax'), false);
  assert.equal(isAllowedExternalUrl('file:///tmp/scriptum'), false);
});

t('the renderer sandbox, permission denial, and network blocks stay enabled', () => {
  const main = fs.readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');

  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /sandbox:\s*true/);
  assert.match(main, /disable-background-networking/);
  assert.match(main, /onBeforeRequest[\s\S]*callback\(\{ cancel: true \}\)/);
  assert.match(main, /setPermissionRequestHandler[\s\S]*callback\(false\)/);
  assert.match(main, /setPermissionCheckHandler\(\(\) => false\)/);
  assert.match(html, /connect-src 'none'/);
});

console.log(`\n${pass} security checks passed.`);
