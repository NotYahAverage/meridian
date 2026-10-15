// Tags this version (v0.3.0…) and pushes the tag: GitHub then builds the Mac app (.github/workflows/release-mac.yml).
const { execFileSync } = require('node:child_process');
const version = require('./package.json').version;
const tag = `v${version}`;
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
if (!git('tag', '--list', tag)) git('tag', tag);
execFileSync('git', ['push', 'origin', tag], { stdio: 'inherit' });
