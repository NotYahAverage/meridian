import './ui/styles.css';
import { Game } from './game/Game';
import * as CityCommands from './sim/CityCommands';
import { fastForward, tickCity } from './sim/CitySim';
import { serializeCity } from './sim/save/Serializer';
import { platform } from './platform/Platform';
import { newBuilding } from './sim/buildings/Buildings';
import { lotFrame } from './sim/buildings/Spawner';
import { ARCHETYPES, capacityFor } from './sim/buildings/Archetypes';
import * as Terraform from './sim/world/Terraform';

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

function fatal(msg: string): void {
  const el = document.getElementById('ui')!;
  el.innerHTML = `<div class="fatal"><h1>Meridian can't start</h1><p>${msg}</p></div>`;
}

async function main(): Promise<void> {
  if (!webglAvailable()) {
    fatal('Your browser or graphics driver does not support WebGL 2. Please update your browser or graphics drivers.');
    return;
  }
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const ui = document.getElementById('ui') as HTMLElement;
  const game = new Game(canvas, ui);
  // Automation/debug hook (used by the Playwright end-to-end tests).
  const params = new URLSearchParams(location.search);
  if (import.meta.env.DEV || params.has('e2e')) {
    (window as unknown as Record<string, unknown>).__meridian = { game, CityCommands, tickCity, fastForward, serializeCity, storage: platform.storage, Terraform, sim: { newBuilding, lotFrame, ARCHETYPES, capacityFor } };
  }
  await game.boot();
}

main().catch((e) => {
  console.error(e);
  fatal(String(e?.message ?? e));
});
