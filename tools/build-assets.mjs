// Rebuilds the game's 3D models with Blender (background mode).
// Usage: npm run assets            (finds Blender automatically)
//        BLENDER=/path/to/blender npm run assets
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function findBlender() {
  if (process.env.BLENDER && fs.existsSync(process.env.BLENDER)) return process.env.BLENDER;
  const candidates = [];
  if (process.platform === 'win32') {
    const root = 'C:\\Program Files\\Blender Foundation';
    if (fs.existsSync(root)) {
      for (const d of fs.readdirSync(root).sort().reverse()) candidates.push(path.join(root, d, 'blender.exe'));
    }
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/Blender.app/Contents/MacOS/Blender');
  } else {
    candidates.push('/usr/bin/blender', '/usr/local/bin/blender', '/snap/bin/blender');
  }
  return candidates.find((c) => fs.existsSync(c)) ?? 'blender';
}

const blender = findBlender();
const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'public', 'assets', 'models');
const preview = path.join(root, 'tools', 'blender', 'preview.png');
console.log(`Using Blender: ${blender}`);
const r = spawnSync(blender, ['--background', '--factory-startup', '--python', path.join(root, 'tools', 'blender', 'build_assets.py'), '--', out, preview], { stdio: 'inherit' });
if (r.error) {
  console.error('Could not run Blender. Install Blender 4.2+ or set the BLENDER environment variable.');
  process.exit(1);
}
process.exit(r.status ?? 0);
