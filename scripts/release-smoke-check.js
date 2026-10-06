const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const bundlePath = path.join(root, 'dist', 'dist.js');
const indexPath = path.join(root, 'public', 'index.html');
const readmePath = path.join(root, 'README.md');
const licensePath = path.join(root, 'LICENSE');

const fail = message => {
  throw new Error(`Release smoke check failed: ${message}`);
};

for (const required of [bundlePath, indexPath, readmePath, licensePath]) {
  if (!fs.existsSync(required)) {
    fail(`missing ${path.relative(root, required)}`);
  }
}

const bundle = fs.readFileSync(bundlePath, 'utf8');
const index = fs.readFileSync(indexPath, 'utf8');
const readme = fs.readFileSync(readmePath, 'utf8');

if (bundle.length < 10000) {
  fail('production bundle is unexpectedly small');
}

const startMarker = 'const instagramScript = "';
const endMarker = '";//__END_OF_SCRIPT__';
const start = index.indexOf(startMarker);
const end = index.lastIndexOf(endMarker);

if (start < 0 || end < 0 || end <= start + startMarker.length) {
  fail('copy page does not contain an embedded production bundle');
}

const embeddedLength = end - (start + startMarker.length);
if (embeddedLength < 10000) {
  fail('embedded script is unexpectedly small');
}

if (readme.includes('davidarroyo1234.github.io/InstagramUnfollowers')) {
  fail('README still points users to the upstream Pages build');
}

if (!readme.includes('Hassan-Merhi/InstagramUnfollowers')) {
  fail('README does not identify this repository');
}

if (/Anti-Ban|Anti-Detection|anti-?bloqueo|anti-?detecci/i.test(readme)) {
  fail('README contains unsupported anti-detection guarantees');
}

console.log('Release smoke checks passed.');
