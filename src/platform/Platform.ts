import type { SaveData, SaveMeta } from '../sim/save/Serializer';

export interface SlotInfo {
  id: string;
  meta: SaveMeta;
  thumbnail: string;
  bytes: number;
}

/** Storage backend for save games (IndexedDB in browsers; a native bridge can replace it in Electron). */
export interface SaveStorage {
  list(): Promise<SlotInfo[]>;
  save(id: string, data: SaveData, thumbnail: string): Promise<void>;
  load(id: string): Promise<SaveData | null>;
  remove(id: string): Promise<void>;
}

/**
 * Optional bridge exposed by a desktop shell (e.g. Electron preload script as
 * `window.meridianNative`). The browser build works without it.
 */
export interface NativeBridge {
  storage?: SaveStorage;
  quit?: () => void;
  setFullscreen?: (on: boolean) => void;
  isFullscreen?: () => Promise<boolean>;
  /** Called when the player closes the window; the game answers by calling `quit`. */
  onCloseRequested?: (cb: () => void) => void;
}

declare global {
  interface Window {
    meridianNative?: NativeBridge;
  }
}

const DB = 'meridian';
const STORE = 'saves';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

interface Row {
  id: string;
  meta: SaveMeta;
  thumbnail: string;
  payload: Blob | string;
  compressed: boolean;
}

async function compress(text: string): Promise<{ payload: Blob | string; compressed: boolean }> {
  if (typeof CompressionStream === 'undefined') return { payload: text, compressed: false };
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return { payload: await new Response(stream).blob(), compressed: true };
}

async function decompress(row: Row): Promise<string> {
  if (!row.compressed) return row.payload as string;
  const stream = (row.payload as Blob).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}

/** IndexedDB-backed save slots with gzip compression. */
export class IndexedDbStorage implements SaveStorage {
  private dbp: Promise<IDBDatabase> | null = null;

  private db(): Promise<IDBDatabase> {
    if (!this.dbp) this.dbp = openDb();
    return this.dbp;
  }

  private async tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async list(): Promise<SlotInfo[]> {
    const rows = (await this.tx('readonly', (s) => s.getAll())) as Row[];
    return rows
      .map((r) => ({ id: r.id, meta: r.meta, thumbnail: r.thumbnail, bytes: r.payload instanceof Blob ? r.payload.size : r.payload.length }))
      .sort((a, b) => (a.meta.savedAt < b.meta.savedAt ? 1 : -1));
  }

  async save(id: string, data: SaveData, thumbnail: string): Promise<void> {
    const { payload, compressed } = await compress(JSON.stringify(data));
    const row: Row = { id, meta: data.meta, thumbnail, payload, compressed };
    await this.tx('readwrite', (s) => s.put(row));
  }

  async load(id: string): Promise<SaveData | null> {
    const row = (await this.tx('readonly', (s) => s.get(id))) as Row | undefined;
    if (!row) return null;
    return JSON.parse(await decompress(row)) as SaveData;
  }

  async remove(id: string): Promise<void> {
    await this.tx('readwrite', (s) => s.delete(id));
  }
}

export const platform = {
  isDesktop: !!window.meridianNative,
  storage: (window.meridianNative?.storage ?? new IndexedDbStorage()) as SaveStorage,
  quit: window.meridianNative?.quit,
  setFullscreen: window.meridianNative?.setFullscreen,
  isFullscreen: window.meridianNative?.isFullscreen,
  onCloseRequested: window.meridianNative?.onCloseRequested,
};

/** Player preferences persisted in localStorage. */
export interface Settings {
  quality: 'low' | 'medium' | 'high';
  dayNight: boolean;
  edgeScroll: boolean;
  invertRotate: boolean;
  /** Mouse look sensitivity, 0.4–2. */
  lookSpeed?: number;
  /** Mouse layout: free cam (right-drag looks) or the classic city-builder one (right-drag pans). */
  cameraStyle?: 'free' | 'classic';
  /** Set once Classic became the default camera (older settings are moved over to it). */
  cameraDefaultV2?: boolean;
  /** Player keybinding overrides (action id → bindings). */
  keybinds?: Record<string, string[]>;
  /** Keyboard drawn in the Controls window. */
  keyboardLayout?: 'full' | 'tkl' | '75' | '65' | '60';
  masterVolume: number;
  sfxVolume: number;
  ambientVolume: number;
  musicVolume: number;
  autosave: boolean;
  trafficDensity: number;
  showIcons: boolean;
  tutorial: boolean;
  streetNames: boolean;
  /** Rare tornadoes in spring and summer storms. */
  disasters: boolean;
  /** Scenarios the player has won. */
  scenariosWon: string[];
  /** Interface scale: 0 = automatic (follows screen height), otherwise a factor. */
  uiScale: number;
}

export const DEFAULT_SETTINGS: Settings = {
  quality: 'high',
  dayNight: true,
  edgeScroll: false,
  invertRotate: false,
  lookSpeed: 1,
  cameraStyle: 'classic',
  cameraDefaultV2: true,
  masterVolume: 0.8,
  sfxVolume: 0.8,
  ambientVolume: 0.5,
  musicVolume: 0.4,
  autosave: true,
  trafficDensity: 1,
  showIcons: true,
  tutorial: true,
  streetNames: true,
  disasters: false,
  scenariosWon: [],
  uiScale: 0,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem('meridian.settings');
    if (raw) {
      const s: Settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
      // Classic is the default camera now; settings saved before that switch over once.
      if (!s.cameraDefaultV2) {
        s.cameraStyle = 'classic';
        s.cameraDefaultV2 = true;
      }
      return s;
    }
  } catch {
    /* storage unavailable */
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem('meridian.settings', JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}
