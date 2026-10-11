import type { Game } from '../game/Game';
import { ACTIONS, type ActionDef, FIXED_KEYS, bindingName, keyName, parseBinding } from '../game/Keybinds';
import { saveSettings } from '../platform/Platform';
import { h } from './dom';
import { icon } from './icons';
import { Modal } from './Menus';

export type KeyboardLayoutId = 'full' | 'tkl' | '75' | '65' | '60';

export const KEYBOARD_LAYOUTS: [KeyboardLayoutId, string][] = [
  ['full', 'Full size (100%)'],
  ['tkl', 'Tenkeyless (80%)'],
  ['75', 'Compact (75%)'],
  ['65', 'Compact (65%)'],
  ['60', 'Mini (60%)'],
];

interface Key {
  code: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const LETTERS1 = 'QWERTYUIOP'.split('').map((c) => `Key${c}`);
const LETTERS2 = 'ASDFGHJKL'.split('').map((c) => `Key${c}`);
const LETTERS3 = 'ZXCVBNM'.split('').map((c) => `Key${c}`);
const DIGITS = '1234567890'.split('').map((c) => `Digit${c}`);

/** Lays keys left to right from x0; entries are a code or [code, width]. */
function row(out: Key[], y: number, x0: number, keys: (string | [string, number])[]): void {
  let x = x0;
  for (const k of keys) {
    const [code, w] = typeof k === 'string' ? [k, 1] : k;
    out.push({ code, x, y, w, h: 1 });
    x += w;
  }
}

/** ANSI keyboards from full size down to 60%. Units are key widths. */
export function keyboardLayout(id: KeyboardLayoutId): Key[] {
  const k: Key[] = [];
  const compact = id === '75' || id === '65';
  const escInNumbers = id === '65' || id === '60';
  const top = id === 'full' || id === 'tkl' ? 1.5 : id === '75' ? 1.25 : 0;
  // Function row.
  if (id === 'full' || id === 'tkl') {
    row(k, 0, 0, ['Escape']);
    row(k, 0, 2, ['F1', 'F2', 'F3', 'F4']);
    row(k, 0, 6.5, ['F5', 'F6', 'F7', 'F8']);
    row(k, 0, 11, ['F9', 'F10', 'F11', 'F12']);
    row(k, 0, 15.25, ['PrintScreen', 'ScrollLock', 'Pause']);
  } else if (id === '75') {
    row(k, 0, 0, ['Escape', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', 'PrintScreen', 'Insert', 'Delete']);
  }
  // Main block.
  row(k, top, 0, [escInNumbers ? 'Escape' : 'Backquote', ...DIGITS, 'Minus', 'Equal', ['Backspace', 2]]);
  row(k, top + 1, 0, [['Tab', 1.5], ...LETTERS1, 'BracketLeft', 'BracketRight', ['Backslash', 1.5]]);
  row(k, top + 2, 0, [['CapsLock', 1.75], ...LETTERS2, 'Semicolon', 'Quote', ['Enter', 2.25]]);
  if (compact) {
    row(k, top + 3, 0, [['ShiftLeft', 2.25], ...LETTERS3, 'Comma', 'Period', 'Slash', ['ShiftRight', 1.75], 'ArrowUp']);
    row(k, top + 4, 0, [['ControlLeft', 1.25], ['MetaLeft', 1.25], ['AltLeft', 1.25], ['Space', 6.25], 'AltRight', 'ContextMenu', 'ControlRight', 'ArrowLeft', 'ArrowDown', 'ArrowRight']);
    for (const [i, code] of ['Home', 'PageUp', 'PageDown', 'End'].entries()) k.push({ code, x: 15, y: top + i, w: 1, h: 1 });
  } else {
    row(k, top + 3, 0, [['ShiftLeft', 2.25], ...LETTERS3, 'Comma', 'Period', 'Slash', ['ShiftRight', 2.75]]);
    row(k, top + 4, 0, [['ControlLeft', 1.25], ['MetaLeft', 1.25], ['AltLeft', 1.25], ['Space', 6.25], ['AltRight', 1.25], ['MetaRight', 1.25], ['ContextMenu', 1.25], ['ControlRight', 1.25]]);
  }
  // Navigation cluster and arrows.
  if (id === 'full' || id === 'tkl') {
    row(k, top, 15.25, ['Insert', 'Home', 'PageUp']);
    row(k, top + 1, 15.25, ['Delete', 'End', 'PageDown']);
    row(k, top + 3, 16.25, ['ArrowUp']);
    row(k, top + 4, 15.25, ['ArrowLeft', 'ArrowDown', 'ArrowRight']);
  }
  // Number pad.
  if (id === 'full') {
    const x = 18.5;
    row(k, top, x, ['NumLock', 'NumpadDivide', 'NumpadMultiply', 'NumpadSubtract']);
    row(k, top + 1, x, ['Numpad7', 'Numpad8', 'Numpad9']);
    k.push({ code: 'NumpadAdd', x: x + 3, y: top + 1, w: 1, h: 2 });
    row(k, top + 2, x, ['Numpad4', 'Numpad5', 'Numpad6']);
    row(k, top + 3, x, ['Numpad1', 'Numpad2', 'Numpad3']);
    k.push({ code: 'NumpadEnter', x: x + 3, y: top + 3, w: 1, h: 2 });
    row(k, top + 4, x, [['Numpad0', 2], 'NumpadDecimal']);
  }
  return k;
}

const MODIFIER_KEY: Record<string, 'shift' | 'ctrl' | 'alt'> = { ShiftLeft: 'shift', ShiftRight: 'shift', ControlLeft: 'ctrl', ControlRight: 'ctrl', AltLeft: 'alt', AltRight: 'alt' };

/**
 * Controls: a picture of the player's keyboard showing which keys are free,
 * in use, or used by more than one action, plus every action with its keys.
 * Click a key binding, then press the new key to change it.
 */
export class ControlsDialog extends Modal {
  /** Action and binding slot being changed (waiting for a key press). */
  private capture: { id: string; slot: number } | null = null;
  private selectedKey: string | null = null;

  constructor(game: Game) {
    super(game, 'Controls', 'controls');
    // Capture-phase listener, so the game never sees the key that is being assigned.
    window.addEventListener('keydown', (e) => {
      if (!this.capture || !this.isOpen) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (MODIFIER_KEY[e.code] || e.code.startsWith('Meta')) return;
      if (e.code === 'Escape') {
        this.capture = null;
        this.render();
        return;
      }
      const def = ACTIONS.find((a) => a.id === this.capture!.id)!;
      const mods = def.held ? '' : `${e.ctrlKey || e.metaKey ? 'Ctrl+' : ''}${e.altKey ? 'Alt+' : ''}${e.shiftKey ? 'Shift+' : ''}`;
      const list = [...this.game.keys.get(def.id)];
      list[this.capture.slot] = mods + e.code;
      this.game.keys.set(def.id, list);
      this.capture = null;
      this.selectedKey = e.code;
      this.persist();
      this.render();
    }, true);
  }

  open(): void {
    this.capture = null;
    this.selectedKey = null;
    super.open();
    this.render();
  }

  close(): void {
    this.capture = null;
    super.close();
  }

  private get layout(): KeyboardLayoutId {
    return this.game.settings.keyboardLayout ?? 'full';
  }

  private persist(): void {
    this.game.settings.keybinds = this.game.keys.overrides();
    saveSettings(this.game.settings);
    this.game.ui.toolbar.refreshKeyHints();
  }

  private render(): void {
    const b = this.body;
    const keys = this.game.keys;
    const usage = keys.usage();
    const mods = new Set<string>();
    for (const a of ACTIONS) for (const bind of keys.get(a.id)) {
      const p = parseBinding(bind);
      if (p.shift) mods.add('shift');
      if (p.ctrl) mods.add('ctrl');
      if (p.alt) mods.add('alt');
    }
    b.innerHTML = '';

    // Keyboard size and legend.
    const select = h('select', { class: 'text-input kb-size', 'aria-label': 'Keyboard size' }) as HTMLSelectElement;
    for (const [id, label] of KEYBOARD_LAYOUTS) select.append(h('option', { value: id, selected: id === this.layout ? '' : null }, label));
    select.addEventListener('change', () => {
      this.game.settings.keyboardLayout = select.value as KeyboardLayoutId;
      saveSettings(this.game.settings);
      this.render();
    });
    b.append(
      h('div', { class: 'kb-bar' },
        h('label', { class: 'kb-size-label' }, 'Your keyboard', select),
        h('div', { class: 'kb-legend' },
          h('span', { class: 'kb-swatch free' }), 'Free',
          h('span', { class: 'kb-swatch used' }), 'In use',
          h('span', { class: 'kb-swatch shared' }), 'Used by more than one action',
        ),
      ),
    );

    // The keyboard itself.
    const layout = keyboardLayout(this.layout);
    const width = Math.max(...layout.map((k) => k.x + k.w));
    const height = Math.max(...layout.map((k) => k.y + k.h));
    const kb = h('div', { class: 'kb', style: `--kw:${width};--kh:${height}`, role: 'group', 'aria-label': 'Keyboard' });
    for (const key of layout) {
      const acts = usage.get(key.code) ?? [];
      const fixed = FIXED_KEYS[key.code];
      const mod = MODIFIER_KEY[key.code];
      const state = fixed ? 'used' : acts.length > 1 ? 'shared' : acts.length === 1 ? 'used' : mod && mods.has(mod) ? 'mod' : 'free';
      const names = fixed ? [fixed] : acts.map((a) => a.label);
      const tip = `${keyName(key.code)}: ${names.length ? names.join(' · ') : mod && mods.has(mod) ? 'used with other keys' : 'free'}`;
      kb.append(
        h('button', {
          class: `kb-key ${state}${this.selectedKey === key.code ? ' selected' : ''}`,
          style: `left:calc(${key.x} * var(--u));top:calc(${key.y} * var(--u));width:calc(${key.w} * var(--u) - 4px);height:calc(${key.h} * var(--u) - 4px)`,
          'data-code': key.code,
          'data-tip': tip,
          'aria-label': tip,
          onclick: () => {
            this.selectedKey = this.selectedKey === key.code ? null : key.code;
            this.render();
          },
        },
          h('span', { class: 'kb-cap' }, keyName(key.code)),
          names.length && key.w * key.h >= 1 ? h('span', { class: 'kb-act' }, names.length > 1 ? `${names.length} actions` : names[0]) : null,
        ),
      );
    }
    b.append(h('div', { class: 'kb-wrap' }, kb));

    // Actions that can't be reached on this keyboard.
    const present = new Set(layout.map((k) => k.code));
    const missing = ACTIONS.filter((a) => {
      const binds = keys.get(a.id);
      return binds.length > 0 && !binds.some((bind) => present.has(parseBinding(bind).code));
    });
    if (missing.length) {
      b.append(h('div', { class: 'kb-warn' }, icon('warning', 15), h('span', null, `Not on this keyboard: ${missing.map((a) => `${a.label} (${keys.get(a.id).map(bindingName).join(' / ')})`).join(' · ')}. Click those below to choose another key.`)));
    }

    // Selected key: what it does.
    if (this.selectedKey) {
      const acts = usage.get(this.selectedKey) ?? [];
      const fixed = FIXED_KEYS[this.selectedKey];
      b.append(h('div', { class: 'kb-detail' },
        h('b', null, keyName(this.selectedKey)), ': ',
        fixed ? fixed : acts.length ? acts.map((a) => `${a.label} (${keys.get(a.id).filter((x) => parseBinding(x).code === this.selectedKey || x.endsWith(this.selectedKey!.replace('Numpad', 'Digit'))).map(bindingName).join(', ')})`).join(' · ') : 'Free. Pick an action below and press this key to use it.',
      ));
    }

    // Every action with its keys.
    const list = h('div', { class: 'kb-actions' });
    let group = '';
    for (const a of ACTIONS) {
      if (a.group !== group) {
        group = a.group;
        list.append(h('div', { class: 'kb-group' }, group));
      }
      list.append(this.actionRow(a, usage));
    }
    list.append(h('div', { class: 'kb-group' }, 'Mouse & touch'));
    for (const [what, how] of [
      ['Look around / pan', 'Right-drag and middle-drag (swapped in the Classic camera style, Settings)'],
      ['Zoom', 'Mouse wheel'],
      ['Glide to a spot', 'Double-click the map'],
      ['Cancel', 'Right-click'],
      ['Snap road angles · free placement', 'Hold Shift · hold Ctrl while drawing'],
      ['Brush size', 'Alt + wheel'],
      ['Touch', 'Tap to select · drag to pan · pinch to zoom · twist to rotate'],
    ]) list.append(h('div', { class: 'kb-row static' }, h('span', { class: 'kb-row-label' }, what), h('span', { class: 'kb-row-static' }, how)));
    b.append(list);
    b.append(h('div', { class: 'modal-actions' },
      h('button', { class: 'btn', onclick: async () => {
        if (!(await this.game.ui.confirm('Reset controls', 'Put every key back to its default?', 'Reset'))) return;
        keys.reset();
        this.persist();
        this.open();
      } }, 'Reset all to defaults'),
      h('button', { class: 'btn primary', onclick: () => this.close() }, 'Done'),
    ));
  }

  private actionRow(a: ActionDef, usage: Map<string, ActionDef[]>): HTMLElement {
    const keys = this.game.keys;
    const binds = keys.get(a.id);
    const chips: HTMLElement[] = [];
    const slots = Math.min(2, binds.length + 1);
    for (let slot = 0; slot < slots; slot++) {
      const bind = binds[slot];
      const waiting = this.capture?.id === a.id && this.capture.slot === slot;
      const shared = bind ? (usage.get(parseBinding(bind).code)?.length ?? 0) > 1 : false;
      const chip = h('button', {
        class: `kb-chip${bind ? '' : ' add'}${waiting ? ' waiting' : ''}${shared ? ' shared' : ''}${bind && parseBinding(bind).code === this.selectedKey ? ' selected' : ''}`,
        'data-action': a.id,
        'data-slot': String(slot),
        'data-tip': waiting ? 'Press a key (Esc to cancel)' : bind ? 'Click, then press a new key' : 'Add another key',
        onclick: () => {
          this.capture = { id: a.id, slot };
          this.render();
        },
      }, waiting ? 'Press a key…' : bind ? bindingName(bind) : '+ Add');
      chips.push(chip);
      if (bind && !waiting) {
        chips.push(h('button', {
          class: 'kb-clear', 'aria-label': `Remove ${bindingName(bind)}`, 'data-tip': 'Remove this key',
          onclick: () => {
            keys.set(a.id, binds.filter((_, i) => i !== slot));
            this.persist();
            this.render();
          },
        }, icon('close', 11)));
      }
    }
    const changed = binds.join('|') !== a.defaults.join('|');
    return h('div', { class: `kb-row${binds.some((x) => parseBinding(x).code === this.selectedKey) ? ' highlight' : ''}` },
      h('span', { class: 'kb-row-label' }, a.label),
      h('span', { class: 'kb-row-keys' }, ...chips),
      changed ? h('button', { class: 'icon-btn small', 'aria-label': `Reset ${a.label}`, 'data-tip': `Back to ${a.defaults.map(bindingName).join(' / ')}`, onclick: () => { keys.set(a.id, [...a.defaults]); this.persist(); this.render(); } }, icon('upgrade', 13)) : h('span', { class: 'kb-row-pad' }),
    );
  }
}
