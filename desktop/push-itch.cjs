// Pushes the freshly built installer to itch.io with butler (run after a release build).
// Butler must be logged in once: tools\butler\butler.exe login
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const version = require('./package.json').version;
const butler = path.join(__dirname, '..', 'tools', 'butler', process.platform === 'win32' ? 'butler.exe' : 'butler');
const installer = path.join(__dirname, 'release', `Meridian Setup ${version}.exe`);
if (!fs.existsSync(butler)) throw new Error('butler not found: put it in tools/butler');
if (!fs.existsSync(installer)) throw new Error(`installer not found: ${installer}`);
// itch.io page: notyahaverage.itch.io/meridian, Windows channel.
execFileSync(butler, ['push', installer, 'notyahaverage/meridian:windows', '--userversion', version], { stdio: 'inherit' });
