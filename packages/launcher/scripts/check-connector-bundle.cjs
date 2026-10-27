'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const launcherDir = path.resolve(__dirname, '..');
const sourceDir = path.resolve(launcherDir, '../agent-connector');
const packagePath = path.join('node_modules', '@openagents-org', 'agent-launcher');

function filesUnder(root, relative) {
  const absolute = path.join(root, relative);
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink()) throw new Error(`Connector contains a symlink: ${absolute}`);
  if (!stat.isDirectory()) return [relative];
  return fs.readdirSync(absolute).sort().flatMap((name) => filesUnder(root, path.join(relative, name)));
}

// A version can stay unchanged during development; compare source bytes too.
function verifyConnector(expectedDir, actualDir) {
  if (!fs.existsSync(actualDir)) throw new Error(`Connector is missing: ${actualDir}. Run npm ci in packages/launcher.`);
  if (fs.lstatSync(actualDir).isSymbolicLink()) {
    throw new Error('Connector must be an installed copy, not a symlink. Run npm ci with install-links=true.');
  }
  const expected = JSON.parse(fs.readFileSync(path.join(expectedDir, 'package.json'), 'utf8'));
  const actual = JSON.parse(fs.readFileSync(path.join(actualDir, 'package.json'), 'utf8'));
  if (actual.name !== expected.name || actual.version !== expected.version) {
    throw new Error(`Stale connector: expected ${expected.name}@${expected.version}, found ${actual.name}@${actual.version}. Run npm ci in packages/launcher.`);
  }
  for (const field of ['main', 'bin', 'dependencies', 'engines']) {
    if (JSON.stringify(actual[field]) !== JSON.stringify(expected[field])) {
      throw new Error(`Connector package.json differs from this checkout: ${field}`);
    }
  }
  const digest = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  // The publish manifest currently lists literal files/directories.
  for (const entry of expected.files) {
    // electron-builder deliberately strips dependency documentation.
    if (/\.md$/i.test(entry)) continue;
    if (/[*!?{}[\]]/.test(entry)) throw new Error(`Unsupported connector package file pattern: ${entry}`);
    const expectedFiles = filesUnder(expectedDir, entry);
    let actualFiles;
    try { actualFiles = filesUnder(actualDir, entry); } catch {
      throw new Error(`Connector bundle is missing ${entry}`);
    }
    if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
      throw new Error(`Connector file list differs from this checkout: ${entry}`);
    }
    for (const file of expectedFiles) {
      if (digest(path.join(expectedDir, file)) !== digest(path.join(actualDir, file))) {
        throw new Error(`Connector content differs from this checkout: ${file}. Run npm ci in packages/launcher.`);
      }
    }
  }
  console.log(`Connector verified: ${expected.name}@${expected.version} (${actualDir})`);
}

function checkInstalled() {
  verifyConnector(sourceDir, path.join(launcherDir, packagePath));
}

function checkPackaged(context) {
  const resources = context.electronPlatformName === 'darwin'
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : path.join(context.appOutDir, 'resources');
  verifyConnector(sourceDir, path.join(resources, 'app.asar.unpacked', packagePath));
}

module.exports = checkInstalled;
module.exports.verifyConnector = verifyConnector;
module.exports.checkPackaged = checkPackaged;
if (require.main === module) checkInstalled();
