/**
 * Regression test: the application must always be quittable.
 *
 * This guards a bug that made Scriptum impossible to quit at all. Electron
 * treats a cancelled `beforeunload` as a silent, absolute veto — there is no
 * "leave site?" prompt to answer — so the renderer's unsaved-work guard, which
 * is correct in a browser, made the window refuse to close forever. Vetoing
 * the window close in order to ask about unsaved work also cancels the quit
 * itself, so the quit has to be restarted explicitly once the user approves.
 *
 * Both halves are covered here, because either one alone traps the user.
 *
 * Requires Electron, so it is not part of `npm test`. Run with:
 *
 *     npm run test:app
 */

import { spawn } from 'node:child_process';
// The package's default export is the path to the Electron binary. Launching
// it directly matters: going through `npx` makes the spawned child the npx
// wrapper, so killing it leaves Electron orphaned and still holding the
// debugging port. A later run then attaches to the stale instance, installs
// its stub in the wrong process, and reports a failure that is not real.
import electronPath from 'electron';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/**
 * Electron is launched by its real binary rather than through the `electron`
 * shim script. The cancel case leaves the app running on purpose, and killing
 * the shim would orphan the Electron process underneath it — which then held
 * the debugging port, so the *next* run of this file attached to the previous
 * run's window instead of its own and failed for a reason that had nothing to
 * do with quitting. Each run also takes a port nothing is listening on, and
 * refuses to continue if the port is taken.
 */
/** Resolve a port the OS confirms is free, so a stray process cannot be mistaken for ours. */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;

/* ---------------- Chrome DevTools Protocol plumbing ---------------- */

async function findRenderer(PORT, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'));
      if (page) return page;
      // An empty list means something else owns this port. Say so rather than
      // waiting out the timeout with a misleading message.
      if (Array.isArray(list) && list.length && !page) {
        throw new Error(`port ${PORT} is answering, but not with a Scriptum window`);
      }
    } catch {
      /* not listening yet */
    }
    await sleep(400);
  }
  throw new Error('renderer never appeared on the debugging port');
}

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const request = pending.get(m.id);
      clearTimeout(request.timer);
      request.resolve(m);
      pending.delete(m.id);
    }
  });
  ws.addEventListener('close', () => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error('Electron closed the debugging connection before replying.'));
    }
    pending.clear();
  });
  return {
    send: (method, params) =>
      new Promise((resolve, reject) => {
        id += 1;
        const requestId = id;
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(new Error(`Electron did not answer ${method} within 5 seconds.`));
        }, 5000);
        pending.set(requestId, { resolve, reject, timer });
        ws.send(JSON.stringify({ id, method, params }));
      }),
    close: () => ws.close(),
  };
}

async function evaluate(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.result?.exceptionDetails) {
    throw new Error(r.result.exceptionDetails.exception?.description || 'evaluate failed');
  }
  return r.result?.result?.value;
}

/* ---------------- the scenario ---------------- */

/**
 * Launch the app with unsaved changes, answer the save prompt with `answer`,
 * and report whether the process exited.
 *
 * @param {number} answer 1 = "Don't Save", 2 = "Cancel"
 */
async function quitWithUnsavedWork(answer) {
  const PORT = await freePort();
  const profile = mkdtempSync(path.join(tmpdir(), 'scriptum-test-'));
  const args = ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`];
  // GitHub's Linux runners restrict the Chromium OS sandbox used by the
  // unpackaged Electron test binary. Disable that outer process sandbox only
  // for this CI harness; production builds never receive this flag, and the
  // BrowserWindow renderer sandbox remains an asserted release requirement.
  if (process.platform === 'linux' && process.env.CI) args.push('--no-sandbox');
  const child = spawn(
    electronPath,
    args,
    { cwd: ROOT, env: { ...process.env, SCRIPTUM_TEST_QUIT: '9000' }, stdio: 'ignore' }
  );

  let exited = false;
  child.on('exit', () => {
    exited = true;
  });

  try {
    const cdp = await connect((await findRenderer(PORT)).webSocketDebuggerUrl);
    await cdp.send('Runtime.enable', {});

    let ready = false;
    for (let i = 0; i < 40; i += 1) {
      ready = await evaluate(
        cdp,
        'Boolean(window.__scriptum && window.__scriptum.editor.pagination)'
      ).catch(() => false);
      if (ready) break;
      await sleep(400);
    }
    if (!ready) throw new Error('renderer loaded but Scriptum never became ready');

    // Genuine unsaved changes, with the save prompt answered for us.
    await evaluate(
      cdp,
      `(() => {
         const S = window.__scriptum;
         S.editor.commit(() => {
           S.editor.doc.elements[0].text = 'INT. UNSAVED WORK - NIGHT';
           return null;
         });
         S.state.dirty = true;
         S.platform.confirm = async () => ${answer};
       })()`
    );

    // The main process quits on its own timer; give it room to finish.
    await sleep(12000);
    cdp.close();
  } finally {
    const quitCleanly = exited;
    if (!exited) {
      child.kill('SIGKILL');
      // Wait for the process to actually go, so the next run starts clean.
      await new Promise((r) => (exited ? r() : child.once('exit', r)));
      exited = quitCleanly; // killing it is not the app choosing to exit
    }
    // Electron's helper processes can outlive the browser process by a few
    // milliseconds and finish writing profile files after `exit`. Cleanup is
    // secondary to the assertion, so retry after they settle and do not turn
    // a successful quit test into a platform-specific ENOTEMPTY failure.
    await sleep(500);
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch (error) {
      console.warn(`Could not remove temporary Electron profile ${profile}: ${error.message}`);
    }
  }

  return exited;
}

function check(name, ok) {
  if (ok) {
    pass += 1;
    console.log(`  ok  ${name}`);
  } else {
    fail += 1;
    console.log(`FAIL  ${name}`);
    process.exitCode = 1;
  }
}

console.log('\nQuit behaviour (launches Electron; takes about half a minute)\n');

check('quits when the user declines to save', await quitWithUnsavedWork(1));
check('stays open when the user cancels the quit', !(await quitWithUnsavedWork(2)));

console.log(`\n${pass} passed, ${fail} failed.`);
