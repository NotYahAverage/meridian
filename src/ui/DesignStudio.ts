import { formatInt } from '../core/math';
import type { Game } from '../game/Game';
import { capacityFor } from '../sim/buildings/Archetypes';
import type { Chip, Concept, DesignInput } from '../sim/design/Concept';
import { CATEGORY_LABEL, IDEAS, IDEA_BY_ID, type IdeaCategory } from '../sim/design/Ideas';
import { hashStr } from '../sim/research/Generate';
import { AXES, WINDOW_TYPES } from '../sim/style/Movements';
import { h } from './dom';
import { icon } from './icons';
import { Modal } from './Menus';

const EXAMPLES = [
  'a cosy brick cottage with a pitched roof',
  'cheap concrete flats, really tall, with trees on the balconies',
  'white timber row houses with a green roof',
  'sleek glass offices, 25 storeys, with sky gardens',
  'an old-fashioned stone block with arched windows and shops at the bottom',
  'stepped terraces covered in plants, mid-rise',
];

const CAT_ORDER: IdeaCategory[] = ['use', 'height', 'material', 'roof', 'feature', 'character'];

/** How many yaw steps the preview turns through (each is cached). */
const YAWS = 12;

/**
 * The Design Studio: describe a building in your own words, see what your
 * architects understood as idea chips, adjust them, and watch the building
 * take shape in a live 3D preview. Saved designs go to the sketchbook.
 */
export class DesignStudio extends Modal {
  private input: DesignInput = { text: '', added: [], removed: [] };
  private concept: Concept | null = null;
  private tab: 'design' | 'ideas' = 'design';
  private yawStep = 2;
  private name = '';
  private nameEdited = false;
  private timer = 0;
  private seen = -1;
  private els: {
    text?: HTMLTextAreaElement;
    chips?: HTMLElement;
    notes?: HTMLElement;
    cards?: HTMLElement;
    img?: HTMLImageElement;
    spin?: HTMLElement;
    name?: HTMLInputElement;
    desc?: HTMLElement;
    stats?: HTMLElement;
    sketches?: HTMLElement;
  } = {};

  constructor(game: Game) {
    super(game, 'Design Studio', 'design-modal');
  }

  open(opts: { sketchId?: string; tab?: 'design' | 'ideas' } = {}): void {
    if (opts.tab) this.tab = opts.tab;
    const sk = opts.sketchId ? this.game.city?.design.sketches.find((s) => s.id === opts.sketchId) : undefined;
    if (sk) {
      this.input = structuredClone(sk.input);
      this.name = sk.name;
      this.nameEdited = true;
      this.tab = 'design';
    }
    this.render();
    super.open();
    if (this.tab === 'design') setTimeout(() => this.els.text?.focus(), 30);
  }

  update(): void {
    const city = this.game.city;
    if (!this.isOpen || !city || city.design.version === this.seen) return;
    this.seen = city.design.version;
    if (this.tab === 'ideas') this.render();
    else this.refresh();
  }

  private render(): void {
    const b = this.body;
    b.innerHTML = '';
    this.els = {};
    const city = this.game.city;
    if (!city) return;
    this.seen = city.design.version;
    const known = city.design.learned.size;
    b.append(h('div', { class: 'rs-tabs', role: 'tablist' },
      h('button', { class: `ci-tab${this.tab === 'design' ? ' active' : ''}`, role: 'tab', onclick: () => { this.tab = 'design'; this.render(); } }, 'Design'),
      h('button', { class: `ci-tab${this.tab === 'ideas' ? ' active' : ''}`, role: 'tab', onclick: () => { this.tab = 'ideas'; this.render(); } }, 'Ideas', h('span', { class: 'rs-count' }, `${known}/${IDEAS.length}`)),
    ));
    if (this.tab === 'ideas') {
      this.renderIdeas(b);
      return;
    }
    const text = h('textarea', { class: 'ds-text', rows: '3', maxlength: '300', placeholder: `Describe a building… e.g. “${EXAMPLES[city.clock.day % EXAMPLES.length]}”`, 'aria-label': 'Describe a building' }) as HTMLTextAreaElement;
    text.value = this.input.text;
    text.addEventListener('input', () => {
      this.input.text = text.value;
      // Typed words that say otherwise take precedence over earlier removals.
      this.input.removed = this.input.removed.filter((id) => !this.mentions(id));
      this.schedule();
    });
    text.addEventListener('keydown', (e) => e.stopPropagation());
    this.els.text = text;
    this.els.chips = h('div', { class: 'ds-chips', 'aria-live': 'polite' });
    this.els.notes = h('div', { class: 'ds-notes' });
    this.els.cards = h('div', { class: 'ds-cards' });
    const img = h('img', { class: 'ds-img', alt: 'Preview of the design', draggable: 'false' }) as HTMLImageElement;
    this.els.img = img;
    this.els.spin = h('div', { class: 'ds-spin' }, 'Drawing…');
    let dragX: number | null = null;
    const pic = h('div', { class: 'ds-pic' }, img, this.els.spin,
      h('button', { class: 'ds-turn left', 'aria-label': 'Turn left', onclick: () => this.turn(-1) }, '‹'),
      h('button', { class: 'ds-turn right', 'aria-label': 'Turn right', onclick: () => this.turn(1) }, '›'),
    );
    pic.addEventListener('pointerdown', (e) => {
      dragX = e.clientX;
      pic.setPointerCapture(e.pointerId);
    });
    pic.addEventListener('pointermove', (e) => {
      if (dragX === null) return;
      const d = e.clientX - dragX;
      if (Math.abs(d) > 40) {
        this.turn(d > 0 ? -1 : 1);
        dragX = e.clientX;
      }
    });
    pic.addEventListener('pointerup', () => (dragX = null));
    const name = h('input', { class: 'ds-name', maxlength: '48', 'aria-label': 'Name of the design' }) as HTMLInputElement;
    name.addEventListener('input', () => {
      this.name = name.value;
      this.nameEdited = !!name.value.trim();
    });
    name.addEventListener('keydown', (e) => e.stopPropagation());
    this.els.name = name;
    this.els.desc = h('div', { class: 'ds-desc' });
    this.els.stats = h('div', { class: 'ds-stats' });
    this.els.sketches = h('div', { class: 'ds-sketches' });
    b.append(
      h('div', { class: 'ds-wrap' },
        h('div', { class: 'ds-left' },
          h('label', { class: 'ds-label' }, 'Describe a building in your own words'),
          text,
          h('div', { class: 'ds-try' }, h('span', null, 'Try:'), ...EXAMPLES.slice(0, 4).map((ex) => h('button', { class: 'rs-link', onclick: () => { this.input = { text: ex, added: [], removed: [] }; this.nameEdited = false; text.value = ex; this.refresh(); } }, ex))),
          h('div', { class: 'ds-section' }, 'What your architects understood'),
          this.els.chips,
          this.els.notes,
          h('div', { class: 'ds-section' }, 'Or mix ideas by hand'),
          this.els.cards,
          h('div', { class: 'ds-section' }, 'Sketchbook'),
          this.els.sketches,
        ),
        h('div', { class: 'ds-right' },
          pic,
          name,
          this.els.desc,
          this.els.stats,
          h('div', { class: 'ds-actions' },
            h('button', { class: 'btn', onclick: () => { this.input = { text: '', added: [], removed: [] }; this.name = ''; this.nameEdited = false; text.value = ''; this.refresh(); text.focus(); } }, 'Start over'),
            h('button', { class: 'btn primary', onclick: () => this.save() }, icon('save', 14), 'Save to sketchbook'),
          ),
        ),
      ),
    );
    this.refresh();
  }

  private mentions(id: string): boolean {
    const c = this.concept;
    return !!c?.chips.some((ch) => ch.id === id && ch.source === 'text');
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.refresh(), 110);
  }

  private turn(d: number): void {
    this.yawStep = (this.yawStep + d + YAWS) % YAWS;
    this.preview();
  }

  /** Recompiles the design and redraws everything but the text box. */
  private refresh(): void {
    const city = this.game.city;
    if (!city || !this.els.chips) return;
    const c = city.design.compile(this.input);
    this.concept = c;
    // Chips.
    const chips = this.els.chips;
    chips.innerHTML = '';
    if (!this.input.text.trim() && !this.input.added.length) chips.append(h('div', { class: 'hint small' }, 'Start typing: materials, height, roofs, gardens, balconies, character… Your architects will tell you what they understood.'));
    for (const ch of c.chips) chips.append(this.chip(ch));
    for (const ch of c.locked) chips.append(this.chip(ch));
    // Notes and words it didn't know.
    const notes = this.els.notes!;
    notes.innerHTML = '';
    for (const n of c.notes) notes.append(h('div', { class: 'ds-note' }, icon('info', 12), n));
    for (const id of c.blocked) notes.append(h('div', { class: 'ds-note' }, icon('close', 12), `No ${IDEA_BY_ID.get(id)?.name.toLowerCase() ?? id}.`));
    for (const u of c.unknown) {
      const sug = u.suggest.filter((id) => IDEA_BY_ID.has(id));
      notes.append(h('div', { class: 'ds-note warn' }, icon('warning', 12),
        u.note ?? `“${u.word}” isn’t something your architects recognise.`,
        ...sug.map((id) => h('button', { class: 'rs-link', onclick: () => this.add(id) }, `Use ${IDEA_BY_ID.get(id)!.name}`)),
      ));
    }
    // Cards.
    const cards = this.els.cards!;
    cards.innerHTML = '';
    const inConcept = new Set([...c.chips.map((x) => x.id), ...c.locked.map((x) => x.id)]);
    const known = city.design.learned;
    for (const cat of CAT_ORDER) {
      cards.append(h('div', { class: 'ds-cat' },
        h('span', { class: 'ds-cat-name' }, CATEGORY_LABEL[cat]),
        h('div', { class: 'ds-cat-row' }, ...IDEAS.filter((i) => i.category === cat).map((i) => {
          const on = inConcept.has(i.id);
          const lockedIdea = !known.has(i.id);
          return h('button', {
            class: `ds-card${on ? ' on' : ''}${lockedIdea ? ' locked' : ''}`,
            'data-tip': lockedIdea ? `${i.name} — locked. ${i.unlock?.hint ?? ''}` : `${i.name}: ${i.blurb}`,
            'aria-pressed': on ? 'true' : 'false',
            onclick: () => (lockedIdea ? this.game.toastError(`${i.name} is locked: ${i.unlock?.hint ?? ''}`) : on ? this.remove(i.id) : this.add(i.id)),
          }, lockedIdea ? icon('lock', 12) : icon(i.icon, 12), i.name);
        })),
      ));
    }
    // Name, description and numbers.
    if (!this.nameEdited) this.name = c.name;
    this.els.name!.value = this.name;
    this.els.desc!.textContent = c.description;
    const cap = capacityFor(c.kind as never, c.w, c.d, c.floors, c.level);
    const ax = c.look.axes;
    this.els.stats!.innerHTML = '';
    this.els.stats!.append(
      h('div', { class: 'rs-grid' },
        h('span', null, 'Building'), h('b', null, `${c.kind === 'officeTower' ? 'Office tower' : c.kind === 'midrise' ? 'Mid-rise block' : c.kind === 'lowrise' ? 'Low-rise block' : c.kind === 'mixeduse' ? 'Homes over shops' : c.kind === 'townhouse' ? 'Row houses' : c.kind[0].toUpperCase() + c.kind.slice(1)}${c.kind === 'house' || c.kind === 'townhouse' || c.kind === 'shop' ? '' : ` · ${c.floors} storeys`}`),
        h('span', null, cap.households ? 'Homes' : 'Jobs'), h('b', null, cap.households ? `about ${formatInt(cap.households)} households${cap.jobs ? ` · ${formatInt(cap.jobs)} jobs` : ''}` : `about ${formatInt(cap.jobs)}`),
        h('span', null, 'Windows'), h('b', null, WINDOW_TYPES[c.look.windows[0]] ?? '—'),
        h('span', null, 'Testing'), h('b', null, `about ${c.ambition} month${c.ambition === 1 ? '' : 's'} as a prototype`),
      ),
      h('div', { class: 'ds-axes' }, ...AXES.map((a) => {
        const v = ax[a.id];
        return h('div', { class: 'ds-axis', 'data-tip': `${a.low} ↔ ${a.high}` },
          h('span', null, a.low), h('div', { class: 'ds-axis-track' }, h('i', { style: `left:${50 + v * 50}%` })), h('span', null, a.high));
      })),
    );
    this.renderSketches();
    this.preview();
  }

  private chip(ch: Chip): HTMLElement {
    const city = this.game.city!;
    const def = IDEA_BY_ID.get(ch.id);
    const removable = !!def && ch.source !== 'auto';
    // Same-category alternatives for a quick swap (materials and roofs).
    const swaps = def && (def.category === 'material' || def.category === 'roof') ? IDEAS.filter((i) => i.category === def.category && i.id !== def.id && city.design.learned.has(i.id)) : [];
    const from = ch.source === 'text' ? this.input.swaps?.find(([, t]) => t === ch.id)?.[0] : undefined;
    const tip = ch.locked ? `Locked: ${ch.hint ?? 'not learned yet'}` : from ? `Swapped for ${IDEA_BY_ID.get(from)?.name ?? from}${ch.phrase ? ` (“${ch.phrase}”)` : ''}` : ch.fuzzy ? `Read “${ch.fuzzy}” as ${ch.label}` : ch.phrase ? `From “${ch.phrase}”` : ch.source === 'card' ? 'Added by hand' : ch.source === 'auto' ? 'Chosen for you' : '';
    const el = h('span', { class: `ds-chip cat-${ch.category}${ch.locked ? ' locked' : ''}${ch.source === 'auto' ? ' auto' : ''}`, 'data-tip': tip },
      ch.locked ? icon('lock', 11) : null,
      ch.label,
      ch.strong ? h('b', { class: 'ds-plus' }, '+') : ch.weak ? h('b', { class: 'ds-minus' }, '−') : null,
      ch.fuzzy ? h('i', { class: 'ds-fuzzy' }, '?') : null,
    );
    if (swaps.length && !ch.locked) {
      const sel = h('select', { class: 'ds-swap', 'aria-label': `Swap ${ch.label}` }, h('option', { value: '' }, '▾'), ...swaps.map((i) => h('option', { value: i.id }, i.name))) as HTMLSelectElement;
      sel.addEventListener('change', () => {
        if (!sel.value) return;
        if (ch.source === 'text') this.swap(ch.id, sel.value);
        else {
          this.remove(ch.id, false);
          this.add(sel.value);
        }
      });
      el.append(sel);
    }
    if (removable) el.append(h('button', { class: 'ds-x', 'aria-label': `Remove ${ch.label}`, onclick: () => this.remove(ch.id) }, '×'));
    return el;
  }

  private add(id: string): void {
    this.input.removed = this.input.removed.filter((x) => x !== id);
    if (!this.input.added.includes(id)) this.input.added.push(id);
    this.game.play('click');
    this.refresh();
  }

  /** Swaps a typed idea for another, for as long as the text still asks for it. */
  private swap(id: string, to: string): void {
    const prior = this.input.swaps ?? [];
    const from = prior.find(([, t]) => t === id)?.[0] ?? id;
    this.input.swaps = prior.filter(([f]) => f !== from);
    if (to !== from) this.input.swaps.push([from, to]);
    this.input.removed = this.input.removed.filter((x) => x !== to);
    this.game.play('click');
    this.refresh();
  }

  private remove(id: string, redraw = true): void {
    this.input.added = this.input.added.filter((x) => x !== id);
    if (!this.input.removed.includes(id)) this.input.removed.push(id);
    if (redraw) {
      this.game.play('click');
      this.refresh();
    }
  }

  /** Asks for the preview at the current angle (cached per design and angle). */
  private preview(): void {
    const c = this.concept;
    const img = this.els.img;
    if (!c || !img) return;
    const yaw = -0.72 + (this.yawStep - 2) * ((Math.PI * 2) / YAWS);
    const key = `design:${hashStr(JSON.stringify([c.kind, c.floors, c.level, c.look, this.yawStep]))}`;
    const show = (url: string) => {
      if (this.concept !== c) return;
      img.src = url;
      img.classList.add('ready');
      this.els.spin?.classList.add('hidden');
    };
    this.els.spin?.classList.remove('hidden');
    const ready = this.game.thumbs.request(key, { kind: 'building', style: c.kind, w: c.w, d: c.d, floors: c.floors, level: c.level, seed: 4242, look: c.look, yaw, big: true }, show);
    if (ready) show(ready);
  }

  private save(): void {
    const city = this.game.city;
    if (!city || !this.concept) return;
    if (!this.input.text.trim() && !this.input.added.length) {
      this.game.toastError('Describe a building first');
      return;
    }
    const sk = city.design.saveSketch(this.input, this.name);
    this.game.play('good');
    this.game.ui.toasts.push({ severity: 'good', icon: 'save', title: 'Saved to the sketchbook', text: sk.name });
    this.renderSketches();
  }

  private renderSketches(): void {
    const city = this.game.city;
    const el = this.els.sketches;
    if (!city || !el) return;
    el.innerHTML = '';
    if (!city.design.sketches.length) {
      el.append(h('div', { class: 'hint small' }, 'Designs you save appear here. Soon you’ll be able to build them as prototypes and see what residents think.'));
      return;
    }
    for (const sk of [...city.design.sketches].reverse()) {
      const c = sk.concept;
      const img = h('img', { alt: '', draggable: 'false' }) as HTMLImageElement;
      const ready = this.game.thumbs.request(`sketch:${sk.id}`, { kind: 'building', style: c.kind, w: c.w, d: c.d, floors: c.floors, level: c.level, seed: 4242, look: c.look }, (u) => (img.src = u));
      if (ready) img.src = ready;
      el.append(h('div', { class: 'ds-sketch' },
        h('button', { class: 'ds-sketch-open', onclick: () => this.open({ sketchId: sk.id }), 'data-tip': sk.input.text || 'Open this design' }, img, h('b', null, sk.name), h('span', null, c.description)),
        h('button', { class: 'icon-btn small', 'aria-label': 'Delete design', 'data-tip': 'Delete', onclick: () => { city.design.deleteSketch(sk.id); this.renderSketches(); } }, icon('trash', 13)),
      ));
    }
  }

  /** Every idea: how it was learned, or how to learn it. */
  private renderIdeas(b: HTMLElement): void {
    const city = this.game.city!;
    const learned = city.design.learned;
    b.append(h('div', { class: 'hint' }, 'Your architects learn new ideas from what happens in your city. Every city’s history gives it a different toolbox.'));
    for (const cat of CAT_ORDER) {
      const list = IDEAS.filter((i) => i.category === cat);
      b.append(h('div', { class: 'ds-section' }, `${CATEGORY_LABEL[cat]} · ${list.filter((i) => learned.has(i.id)).length}/${list.length}`));
      b.append(h('div', { class: 'ds-idea-grid' }, ...list.map((i) => {
        const l = learned.get(i.id);
        return h('div', { class: `ds-idea${l ? '' : ' locked'}` },
          h('div', { class: 'ds-idea-head' }, l ? icon(i.icon, 14) : icon('lock', 14), h('b', null, l ? i.name : i.name)),
          h('div', { class: 'rs-muted' }, i.blurb),
          h('div', { class: 'ds-idea-how' }, l ? (i.start ? 'Known from the start.' : `Learned on day ${l.day}: ${l.story}`) : `To learn it: ${i.unlock?.hint ?? '—'}`),
        );
      })));
    }
  }
}
