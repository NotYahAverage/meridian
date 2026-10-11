/**
 * Rebindable keyboard shortcuts. Bindings are KeyboardEvent.code strings,
 * optionally prefixed with modifiers ("Shift+Digit1", "Ctrl+KeyS").
 */

export type ActionGroup = 'Camera' | 'Tools' | 'Game' | 'Panels' | 'While building';

export interface ActionDef {
  id: string;
  label: string;
  group: ActionGroup;
  defaults: string[];
  /** Held actions (camera movement) work whatever modifiers are down, so Shift can slow them. */
  held?: boolean;
}

export const ACTIONS: ActionDef[] = [
  { id: 'camForward', label: 'Move forward', group: 'Camera', defaults: ['KeyW', 'ArrowUp'], held: true },
  { id: 'camBack', label: 'Move back', group: 'Camera', defaults: ['KeyS', 'ArrowDown'], held: true },
  { id: 'camLeft', label: 'Move left', group: 'Camera', defaults: ['KeyA', 'ArrowLeft'], held: true },
  { id: 'camRight', label: 'Move right', group: 'Camera', defaults: ['KeyD', 'ArrowRight'], held: true },
  { id: 'camTiltUp', label: 'Tilt up', group: 'Camera', defaults: ['KeyR'], held: true },
  { id: 'camTiltDown', label: 'Tilt down', group: 'Camera', defaults: ['KeyF'], held: true },
  { id: 'camZoomIn', label: 'Zoom in', group: 'Camera', defaults: ['Equal', 'NumpadAdd'], held: true },
  { id: 'camZoomOut', label: 'Zoom out', group: 'Camera', defaults: ['Minus', 'NumpadSubtract'], held: true },
  { id: 'camRotateLeft', label: 'Rotate left (Classic camera)', group: 'Camera', defaults: ['KeyQ'], held: true },
  { id: 'camRotateRight', label: 'Rotate right (Classic camera)', group: 'Camera', defaults: ['KeyE'], held: true },
  { id: 'camReset', label: 'Reset view', group: 'Camera', defaults: ['Home'] },

  { id: 'toolSelect', label: 'Select', group: 'Tools', defaults: ['Digit1'] },
  { id: 'toolRoads', label: 'Roads', group: 'Tools', defaults: ['Digit2', 'KeyT'] },
  { id: 'toolZoning', label: 'Zoning', group: 'Tools', defaults: ['Digit3', 'KeyZ'] },
  { id: 'toolServices', label: 'Services', group: 'Tools', defaults: ['Digit4', 'KeyX'] },
  { id: 'toolUtilities', label: 'Utilities', group: 'Tools', defaults: ['Digit5', 'KeyU'] },
  { id: 'toolTransit', label: 'Transit', group: 'Tools', defaults: ['Digit6', 'KeyY'] },
  { id: 'toolLandscape', label: 'Landscape (terrain)', group: 'Tools', defaults: ['Digit7', 'KeyG'] },
  { id: 'toolBuild', label: 'Open the build dock', group: 'Tools', defaults: ['KeyC'] },
  { id: 'toolBulldoze', label: 'Demolish', group: 'Tools', defaults: ['KeyB'] },
  { id: 'dockPrev', label: 'Previous dock tab', group: 'Tools', defaults: ['KeyQ'] },
  { id: 'dockNext', label: 'Next dock tab', group: 'Tools', defaults: ['KeyE'] },

  { id: 'pause', label: 'Pause / resume', group: 'Game', defaults: ['Space'] },
  { id: 'speed1', label: 'Normal speed', group: 'Game', defaults: ['Shift+Digit1'] },
  { id: 'speed2', label: 'Fast', group: 'Game', defaults: ['Shift+Digit2'] },
  { id: 'speed3', label: 'Very fast', group: 'Game', defaults: ['Shift+Digit3'] },
  { id: 'save', label: 'Save', group: 'Game', defaults: ['Ctrl+KeyS'] },
  { id: 'photo', label: 'Photo mode', group: 'Game', defaults: ['KeyP'] },

  { id: 'layers', label: 'Map layers', group: 'Panels', defaults: ['KeyL'] },
  { id: 'layerCycle', label: 'Next map layer', group: 'Panels', defaults: ['Tab'] },
  { id: 'cityInfo', label: 'City information', group: 'Panels', defaults: ['KeyI'] },
  { id: 'news', label: 'Newspaper', group: 'Panels', defaults: ['KeyN'] },

  { id: 'roadContinue', label: 'Continue the last road', group: 'While building', defaults: ['KeyF'] },
  { id: 'flip', label: 'Flip building to the other side of the street', group: 'While building', defaults: ['KeyR'] },
  { id: 'brushSmaller', label: 'Smaller brush / grid blocks', group: 'While building', defaults: ['BracketLeft'] },
  { id: 'brushBigger', label: 'Bigger brush / grid blocks', group: 'While building', defaults: ['BracketRight'] },
  { id: 'lineFinish', label: 'Finish a transit line', group: 'While building', defaults: ['Enter', 'NumpadEnter'] },
  { id: 'lineUndo', label: 'Remove the last stop of a line', group: 'While building', defaults: ['Backspace'] },
];

export const ACTION_BY_ID = new Map(ACTIONS.map((a) => [a.id, a]));

/** Keys that always do the same thing (not rebindable). */
export const FIXED_KEYS: Record<string, string> = { Escape: 'Cancel / close / pause menu' };

/** Number-row digits also work from the numpad. */
const NUMPAD_ALIAS: Record<string, string> = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`Numpad${i}`, `Digit${i}`]));

export interface ParsedBinding {
  code: string;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
}

export function parseBinding(b: string): ParsedBinding {
  const parts = b.split('+');
  const code = parts.pop()!;
  return { code, shift: parts.includes('Shift'), ctrl: parts.includes('Ctrl'), alt: parts.includes('Alt') };
}

const KEY_NAMES: Record<string, string> = {
  Space: 'Space', Escape: 'Esc', Enter: 'Enter', NumpadEnter: 'Num Enter', Backspace: 'Backspace', Tab: 'Tab',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'",
  Comma: ',', Period: '.', Slash: '/', Backquote: '`', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  NumpadAdd: 'Num +', NumpadSubtract: 'Num −', NumpadMultiply: 'Num *', NumpadDivide: 'Num /', NumpadDecimal: 'Num .',
  PageUp: 'Page Up', PageDown: 'Page Down', Home: 'Home', End: 'End', Insert: 'Insert', Delete: 'Delete',
  CapsLock: 'Caps', ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Ctrl', ControlRight: 'Ctrl', AltLeft: 'Alt', AltRight: 'Alt',
  MetaLeft: 'Win', MetaRight: 'Win', ContextMenu: 'Menu', PrintScreen: 'PrtSc', ScrollLock: 'ScrLk', Pause: 'Pause', NumLock: 'Num',
};

/** Short label for a key code ("KeyQ" → "Q", "Digit1" → "1"). */
export function keyName(code: string): string {
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}

export function bindingName(b: string): string {
  const p = parseBinding(b);
  return [p.ctrl ? 'Ctrl' : '', p.alt ? 'Alt' : '', p.shift ? 'Shift' : '', keyName(p.code)].filter(Boolean).join(' + ');
}

/** Current bindings: defaults with the player's overrides on top. */
export class Keybinds {
  private map = new Map<string, string[]>();

  constructor(overrides: Record<string, string[]> = {}) {
    this.load(overrides);
  }

  load(overrides: Record<string, string[]>): void {
    this.map.clear();
    for (const a of ACTIONS) this.map.set(a.id, [...(overrides[a.id] ?? a.defaults)]);
  }

  /** Only the bindings that differ from the defaults (what gets saved). */
  overrides(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const a of ACTIONS) {
      const cur = this.get(a.id);
      if (cur.join('|') !== a.defaults.join('|')) out[a.id] = [...cur];
    }
    return out;
  }

  get(id: string): string[] {
    return this.map.get(id) ?? [];
  }

  set(id: string, bindings: string[]): void {
    this.map.set(id, bindings.filter((b, i) => b && bindings.indexOf(b) === i));
  }

  reset(): void {
    this.load({});
  }

  /** The first binding of an action, for hints ("F to continue"). */
  label(id: string): string {
    const b = this.get(id)[0];
    return b ? bindingName(b) : 'unbound';
  }

  /** Does this key event trigger the action? Held actions ignore modifiers. */
  matches(id: string, code: string, mods: { shift?: boolean; ctrl?: boolean; alt?: boolean } = {}): boolean {
    const def = ACTION_BY_ID.get(id);
    const c = NUMPAD_ALIAS[code] ?? code;
    for (const b of this.get(id)) {
      const p = parseBinding(b);
      if (p.code !== code && p.code !== c) continue;
      if (def?.held) return true;
      if (!!mods.shift === p.shift && !!mods.ctrl === p.ctrl && !!mods.alt === p.alt) return true;
    }
    return false;
  }

  /** Is a held action's key currently down (from a set of pressed codes)? */
  held(id: string, pressed: Set<string>): boolean {
    for (const b of this.get(id)) if (pressed.has(parseBinding(b).code)) return true;
    return false;
  }

  /** Every action using each physical key (modifiers ignored), including numpad digits that mirror the number row. */
  usage(): Map<string, ActionDef[]> {
    const out = new Map<string, ActionDef[]>();
    const add = (code: string, a: ActionDef) => {
      const list = out.get(code) ?? [];
      if (!list.includes(a)) list.push(a);
      out.set(code, list);
    };
    for (const a of ACTIONS) {
      for (const b of this.get(a.id)) {
        const { code } = parseBinding(b);
        add(code, a);
        for (const [np, d] of Object.entries(NUMPAD_ALIAS)) if (d === code) add(np, a);
      }
    }
    return out;
  }
}
