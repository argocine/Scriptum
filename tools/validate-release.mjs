import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const tag = process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : '';

if (tag) {
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag)) {
    throw new Error(`Release tag is not strict SemVer: ${tag}`);
  }
  if (tag.slice(1) !== pkg.version) {
    throw new Error(`Release tag ${tag} does not match package version ${pkg.version}.`);
  }
}

if (pkg.private !== true) throw new Error('package.json must remain private to prevent npm publication.');
if (pkg.engines?.node !== '>=22.12.0') throw new Error('The supported Node.js release floor changed unexpectedly.');
console.log(tag ? `Validated ${tag}.` : `Validated package version ${pkg.version}.`);
