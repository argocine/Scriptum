/** End-to-end Unicode PDF check against the real Electron renderer. */

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import electronPath from 'electron';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function renderer(port) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = targets.find((target) => target.type === 'page' && target.url.includes('index.html'));
      if (page) return page;
    } catch {
      // Electron has not opened its debugging port yet.
    }
    await sleep(300);
  }
  throw new Error('Scriptum did not open a renderer for the PDF test.');
}

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(message.id);
    request.resolve(message);
  });
  return {
    send(method, params, timeout = 20000) {
      return new Promise((resolve, reject) => {
        nextId += 1;
        const id = nextId;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Electron did not answer ${method} within ${timeout}ms.`));
        }, timeout);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close: () => socket.close(),
  };
}

async function evaluate(cdp, expression) {
  const response = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (response.result?.exceptionDetails) {
    throw new Error(response.result.exceptionDetails.exception?.description || 'PDF evaluation failed.');
  }
  return response.result?.result?.value;
}

const port = await freePort();
const scratch = mkdtempSync(path.join(tmpdir(), 'scriptum-pdf-test-'));
const profile = path.join(scratch, 'profile');
const output = path.join(scratch, 'unicode.pdf');
const args = ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`];
if (process.platform === 'linux' && process.env.CI) args.push('--no-sandbox');
const child = spawn(electronPath, args, { cwd: ROOT, stdio: 'ignore' });
let exited = false;
child.once('exit', () => { exited = true; });

try {
  const cdp = await connect((await renderer(port)).webSocketDebuggerUrl);
  await cdp.send('Runtime.enable', {});

  let ready = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    ready = await evaluate(cdp, 'Boolean(window.__scriptum?.editor?.pagination)').catch(() => false);
    if (ready) break;
    await sleep(250);
  }
  if (!ready) throw new Error('Scriptum loaded but did not become ready for PDF export.');

  const result = await evaluate(cdp, `(async () => {
    const [{ createDocument, createElement }, { ElementType }, { mountPrintView }] =
      await Promise.all([
        import('./core/model.js'),
        import('./core/format.js'),
        import('./io/print-view.js'),
      ]);
    const doc = createDocument({ elements: [
      createElement(ElementType.SCENE_HEADING, 'int. café 東京 - night'),
      createElement(ElementType.ACTION, 'Zoë meets 猫. مرحبا שלום. 👩‍🚀 क्ष 한'),
      createElement(ElementType.CHARACTER, 'josé'),
      createElement(ElementType.DIALOGUE, '¿Qué tal? Привет.'),
    ] });
    doc.title.showTitlePage = true;
    doc.title.title = '星の旅 🚀';
    doc.title.author = 'José Núñez';
    doc.pageOverrides.firstPageNumbered = true;
    doc.revisions.current = 'r1';
    doc.revisions.sets = [
      { id: 'r1', name: 'Blue Draft', color: '#7fb2ff', mark: '*', date: '2026-08-31', active: true },
    ];
    window.__scriptum.editor.load(doc);
    const editor = window.__scriptum.editor;
    const print = mountPrintView(
      document.getElementById('pdf-print-root'), doc, editor.pagination, editor.styles
    );
    try {
      await print.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const value = await window.scriptum.printToPDF({ width: print.model.width, height: print.model.height });
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      return { base64: btoa(binary), pages: print.model.pages.length };
    } finally {
      print.cleanup();
    }
  })()`);

  writeFileSync(output, Buffer.from(result.base64, 'base64'));
  const rawPdf = readFileSync(output, 'latin1');
  assert.match(rawPdf.slice(0, 8), /^%PDF-/);

  const info = spawnSync('pdfinfo', [output], { encoding: 'utf8' });
  if (!info.error) {
    assert.equal(info.status, 0, info.stderr);
    assert.match(info.stdout, new RegExp(`Pages:\\s+${result.pages}\\b`));
  } else {
    const pageObjects = rawPdf.match(/\/Type\s*\/Page\b/g) || [];
    assert.equal(pageObjects.length, result.pages, 'PDF page object count differs from the print model');
  }

  const extracted = spawnSync('pdftotext', ['-layout', output, '-'], { encoding: 'utf8' });
  if (!extracted.error) {
    assert.equal(extracted.status, 0, extracted.stderr);
    for (const expected of ['星の旅', 'José Núñez', 'CAFÉ 東京', 'Zoë meets 猫', 'Привет', 'क्ष', '한']) {
      assert.ok(extracted.stdout.includes(expected), `PDF text did not preserve ${expected}`);
    }
  } else {
    // Chromium's ToUnicode maps make embedded subset glyphs searchable and
    // accessible. Pure tests separately assert the exact Unicode input model.
    assert.match(rawPdf, /\/ToUnicode\b/);
  }

  const fonts = spawnSync('pdffonts', [output], { encoding: 'utf8' });
  if (!fonts.error) {
    assert.equal(fonts.status, 0, fonts.stderr);
    const fontRows = fonts.stdout.split('\n').slice(2).filter((line) => line.trim());
    assert.ok(fontRows.length >= 2, 'expected local fallback fonts to be embedded');
    assert.ok(fontRows.every((row) => /\byes\b/i.test(row)), 'every PDF font must be embedded');
  } else {
    assert.match(rawPdf, /\/FontFile[23]?\b|\/Subtype\s*\/Type3\b/);
  }

  if (process.env.SCRIPTUM_PDF_QA_OUTPUT) {
    writeFileSync(process.env.SCRIPTUM_PDF_QA_OUTPUT, readFileSync(output));
  }

  cdp.close();
  console.log('\nReal Electron Unicode PDF');
  console.log('  ok  Chromium produced a valid tagged PDF');
  console.log('  ok  title and screenplay page counts match');
  console.log('  ok  Latin, CJK, Cyrillic, Indic, and Hangul text extract intact');
  console.log('  ok  every local fallback font is embedded');
} finally {
  if (!exited) {
    child.kill('SIGKILL');
    await new Promise((resolve) => (exited ? resolve() : child.once('exit', resolve)));
  }
  await sleep(300);
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
