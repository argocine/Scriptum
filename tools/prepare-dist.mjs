import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { downloadArtifact } from '@electron/get';
import unzipper from 'unzipper';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const dist = path.join(projectRoot, 'dist');
const electronNotices = path.join(projectRoot, 'build', 'electron-notices');

async function stageElectronNotices() {
  const electron = JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'node_modules', 'electron', 'package.json'), 'utf8'),
  );
  const archive = await downloadArtifact({
    version: electron.version,
    artifactName: 'electron',
    platform: process.platform,
    arch: process.arch,
  });
  const contents = await unzipper.Open.file(archive);

  fs.mkdirSync(electronNotices, { recursive: true });
  for (const [source, destination] of [
    ['LICENSE', 'ELECTRON-LICENSE.txt'],
    ['LICENSES.chromium.html', 'LICENSES.chromium.html'],
  ]) {
    const entry = contents.files.find((file) => file.path === source);
    if (!entry) {
      throw new Error(`Electron archive notice is missing: ${source}`);
    }
    await pipeline(entry.stream(), fs.createWriteStream(path.join(electronNotices, destination)));
  }
}

fs.rmSync(dist, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
fs.rmSync(electronNotices, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
await stageElectronNotices();
console.log('Cleared dist/ and staged Electron license notices.');
