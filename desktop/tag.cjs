// Creates this version's GitHub release (and its tag, v0.3.0…) before anything is built, so the
// Windows build here and the Mac build on GitHub (.github/workflows/release-mac.yml, started by
// the new tag) both add their files to the same release instead of racing to create it.
const { execFileSync } = require('node:child_process');
const version = require('./package.json').version;
const tag = `v${version}`;
const token = process.env.GH_TOKEN;
if (!token) throw new Error('GH_TOKEN is not set');
const api = (path, init = {}) => fetch(`https://api.github.com/repos/NotYahAverage/meridian${path}`, {
  ...init,
  headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
});
(async () => {
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const existing = await api(`/releases/tags/${tag}`);
  if (existing.status === 404) {
    const res = await api('/releases', { method: 'POST', body: JSON.stringify({ tag_name: tag, target_commitish: sha, name: version }) });
    if (!res.ok) throw new Error(`Could not create the release: ${res.status} ${await res.text()}`);
    console.log(`Created release ${tag}`);
  } else console.log(`Release ${tag} already exists`);
  execFileSync('git', ['fetch', '--tags', 'origin'], { stdio: 'inherit' });
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
