import fs from 'node:fs';
import path from 'node:path';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const dist = path.resolve('dist');
const files = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(target);
    else files.push(target);
  }
}

walk(dist);
const artifacts = files.filter((file) => /\.(?:dmg|zip|exe|AppImage|deb)$/.test(file));
if (!artifacts.length) throw new Error('The package build produced no distributable artifact.');
if (artifacts.some((file) => !path.basename(file).includes(pkg.version))) {
  throw new Error('A distributable artifact does not contain the package version in its name.');
}
for (const notice of ['ELECTRON-LICENSE.txt', 'LICENSES.chromium.html', 'THIRD_PARTY_NOTICES.md']) {
  if (!files.some((file) => path.basename(file) === notice)) {
    throw new Error(`Packaged third-party notice is missing: ${notice}`);
  }
}
if (!files.some((file) => path.basename(file) === 'app.asar')) {
  throw new Error('The packaged application archive is missing.');
}
console.log(`Verified ${artifacts.length} artifact(s) and packaged license notices for ${pkg.version}.`);
