import { formatInt, formatMoney } from '../core/math';
import type { Game } from '../game/Game';
import type { Chip, Concept, DesignInput } from '../sim/design/Concept';
import { ASPECTS, GRADE_LABEL, MAX_ACTIVE_TRIALS, type Trial, complaints, protoSpec } from '../sim/design/Trials';
import { PUSH_LEVELS, globalShare, moodOf, nextRevision, reachOf, styleName } from '../sim/design/Styles';
import { rebuildPrototype } from '../sim/CityCommands';
import { Clock } from '../sim/Clock';
import { GROUPS, GROUP_BY_ID, type GroupId, approvalFromScore, likeOf, predictGroups, tastesOf } from '../sim/design/Tastes';
import { STAGE_LABEL, type Petition } from '../sim/design/People';
import { COMBOS, COMBO_BY_ID } from '../sim/design/Combos';
import { type Born, LANDMARK_FORMS, type LandmarkForm } from '../sim/design/DesignLab';
import type { PlaceTool } from '../tools/PlaceTool';
import type { PrototypeTool } from '../tools/PrototypeTool';
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

type Tab = 'design' | 'prototypes' | 'styles' | 'people' | 'ideas';

/** Buildings in an adopted style lit up on the map. */
const STYLE_HIGHLIGHT = 6;

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
  private tab: Tab = 'design';
  /** The trial whose design is being revised (0 when not refining). */
  private refining = 0;
  /** A trial to scroll to when the prototypes tab opens. */
  private focusTrial = 0;
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

  open(opts: { sketchId?: string; tab?: Tab; trialId?: number; refineTrialId?: number } = {}): void {
    if (opts.tab) this.tab = opts.tab;
    this.focusTrial = opts.trialId ?? 0;
    const design = this.game.city?.design;
    const sk = opts.sketchId ? design?.sketches.find((s) => s.id === opts.sketchId) : undefined;
    if (sk) {
      this.input = structuredClone(sk.input);
      this.name = sk.name;
      this.nameEdited = true;
      this.tab = 'design';
      this.refining = 0;
    }
    // Refining: the tested design on the drawing board, with what people said about it.
    const rt = opts.refineTrialId ? design?.trial(opts.refineTrialId) : undefined;
    const rsk = rt ? design?.sketches.find((s) => s.id === rt.sketchId) : undefined;
    if (rt && rsk) {
      this.input = structuredClone(rsk.input);
      this.name = nextRevision(rt.name);
      this.nameEdited = true;
      this.tab = 'design';
      this.refining = rt.id;
    }
    this.game.world?.buildings.clearMarks();
    this.render();
    super.open();
    if (this.tab === 'design') setTimeout(() => this.els.text?.focus(), 30);
  }

  update(): void {
    const city = this.game.city;
    if (!this.isOpen || !city) return;
    // Don't rebuild a list under the pointer (keeps its buttons clickable); try again next frame.
    const version = city.design.version + city.people.version * 100_000;
    if (version === this.seen) return;
    if ((this.tab === 'prototypes' || this.tab === 'styles' || this.tab === 'people') && this.body.matches(':hover')) return;
    this.seen = version;
    if (this.tab === 'design') this.refresh();
    else this.render();
  }

  private render(): void {
    const b = this.body;
    b.innerHTML = '';
    this.els = {};
    const city = this.game.city;
    if (!city) return;
    this.seen = city.design.version + city.people.version * 100_000;
    const known = city.design.learned.size;
    const openPetitions = city.people.petitions.filter((p) => p.state === 'open').length;
    b.append(h('div', { class: 'rs-tabs', role: 'tablist' },
      h('button', { class: `ci-tab${this.tab === 'design' ? ' active' : ''}`, role: 'tab', onclick: () => { this.tab = 'design'; this.render(); } }, 'Design'),
      h('button', { class: `ci-tab${this.tab === 'prototypes' ? ' active' : ''}`, role: 'tab', onclick: () => { this.tab = 'prototypes'; this.render(); } }, 'Prototypes', city.design.trials.length ? h('span', { class: 'rs-count' }, `${city.design.activeTrials().length}/${MAX_ACTIVE_TRIALS}`) : null),
      h('button', { class: `ci-tab${this.tab === 'styles' ? ' active' : ''}`, role: 'tab', onclick: () => { this.tab = 'styles'; this.render(); } }, 'City style', city.design.styles.length ? h('span', { class: 'rs-count' }, `${city.design.styles.length}`) : null),
      h('button', { class: `ci-tab${this.tab === 'people' ? ' active' : ''}`, role: 'tab', onclick: () => { this.tab = 'people'; this.render(); } }, 'People', openPetitions ? h('span', { class: 'rs-count warn' }, `${openPetitions}`) : null),
      h('button', { class: `ci-tab${this.tab === 'ideas' ? ' active' : ''}`, role: 'tab', onclick: () => { this.tab = 'ideas'; this.render(); } }, 'Ideas', h('span', { class: 'rs-count' }, `${known}/${IDEAS.length}`)),
    ));
    if (this.tab === 'people') {
      this.renderPeople(b);
      return;
    }
    if (this.tab === 'styles') {
      this.renderStyles(b);
      return;
    }
    if (this.tab === 'ideas') {
      this.renderIdeas(b);
      return;
    }
    if (this.tab === 'prototypes') {
      this.renderTrials(b);
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
    // Typing stays in the box; Esc still closes the studio.
    text.addEventListener('keydown', (e) => { if (e.code !== 'Escape') e.stopPropagation(); });
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
    name.addEventListener('keydown', (e) => { if (e.code !== 'Escape') e.stopPropagation(); });
    this.els.name = name;
    this.els.desc = h('div', { class: 'ds-desc' });
    this.els.stats = h('div', { class: 'ds-stats' });
    this.els.sketches = h('div', { class: 'ds-sketches' });
    b.append(
      h('div', { class: 'ds-wrap' },
        h('div', { class: 'ds-left' },
          this.refineBanner(),
          h('label', { class: 'ds-label' }, this.refining ? 'Change what you want to change' : 'Describe a building in your own words'),
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
          this.actions(text),
        ),
      ),
    );
    this.refresh();
  }

  /** What people said about the design being refined, and what the architects suggest. */
  private refineBanner(): HTMLElement | null {
    const city = this.game.city!;
    const t = this.refining ? city.design.trial(this.refining) : undefined;
    const v = t?.verdict;
    if (!t || !v) return null;
    const worst = complaints(t).slice(0, 2).map((c) => t.reactions.filter((r) => r.key === c.key && r.mood < 0).sort((a, b) => a.mood - b.mood)[0]).filter((r) => !!r);
    return h('div', { class: 'ds-refine' },
      h('div', { class: 'ds-refine-head' }, icon('brush', 14), h('b', null, `Refining ${t.name}`), h('span', { class: 'rs-muted' }, `${GRADE_LABEL[v.grade]} · ${v.approval}% approved`),
        h('button', { class: 'icon-btn small', 'aria-label': 'Stop refining', 'data-tip': 'Stop refining', onclick: () => { this.refining = 0; this.render(); } }, icon('close', 13))),
      worst.length ? h('div', { class: 'tr-quotes' }, ...worst.map((r) => this.quote(r))) : null,
      ...v.advice.map((a) => h('div', { class: 'tr-advice-item' }, icon('info', 12), a)),
      h('div', { class: 'hint small' }, 'Change the description or the cards, then build the revised version. It is tested for a month less, and people will notice what you fixed.'),
    );
  }

  private actions(text: HTMLTextAreaElement): HTMLElement {
    const city = this.game.city!;
    const t = this.refining ? city.design.trial(this.refining) : undefined;
    const inPlace = !!t && t.state === 'done' && !!city.buildings.get(t.buildingId);
    return h('div', { class: 'ds-actions' },
      h('button', { class: 'btn', onclick: () => { this.input = { text: '', added: [], removed: [] }; this.name = ''; this.nameEdited = false; this.refining = 0; text.value = ''; this.render(); this.els.text?.focus(); } }, 'Start over'),
      h('button', { class: 'btn', onclick: () => this.save() }, icon('save', 14), 'Save to sketchbook'),
      inPlace ? h('button', { class: 'btn ds-rebuild', 'data-tip': `Replace ${t!.name} with the new version on the same lot`, onclick: () => this.rebuild() }, icon('upgrade', 14), 'Rebuild on its lot') : null,
      h('button', { class: 'btn primary ds-build', onclick: () => this.build() }, icon('build', 14), t ? 'Build revised prototype' : 'Build prototype'),
    );
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
    for (const id of c.combos ?? []) {
      const def = COMBO_BY_ID.get(id)!;
      const isNew = !city.design.found.has(id);
      notes.append(h('div', { class: `ds-combo${isNew ? ' new' : ''}`, 'data-combo': id, 'data-tip': `${def.blurb} Once a design with it is adopted: ${def.effect.charAt(0).toLowerCase()}${def.effect.slice(1)}` },
        icon(def.icon, 14), h('b', null, def.name), h('span', null, isNew ? 'New combo! Save or build it to discover it.' : def.effect)));
    }
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
    const spec = protoSpec(c);
    const ax = c.look.axes;
    this.els.stats!.innerHTML = '';
    this.els.stats!.append(
      h('div', { class: 'rs-grid' },
        h('span', null, 'Building'), h('b', null, `${c.kind === 'officeTower' ? 'Office tower' : c.kind === 'midrise' ? 'Mid-rise block' : c.kind === 'lowrise' ? 'Low-rise block' : c.kind === 'mixeduse' ? 'Homes over shops' : c.kind === 'townhouse' ? 'Row houses' : c.kind[0].toUpperCase() + c.kind.slice(1)}${c.kind === 'house' || c.kind === 'townhouse' || c.kind === 'shop' ? '' : ` · ${c.floors} storeys`}`),
        h('span', null, spec.households ? 'Homes' : 'Jobs'), h('b', null, spec.households ? `about ${formatInt(spec.households)} household${spec.households === 1 ? '' : 's'}${spec.jobs ? ` · ${formatInt(spec.jobs)} jobs` : ''}` : `about ${formatInt(spec.jobs)}`),
        h('span', null, 'Windows'), h('b', null, WINDOW_TYPES[c.look.windows[0]] ?? '—'),
        h('span', null, 'Prototype'), h('b', null, `${formatMoney(spec.cost)} · tested for ${c.ambition} month${c.ambition === 1 ? '' : 's'}`),
      ),
      h('div', { class: 'ds-who' }, h('span', { class: 'ds-who-label' }, 'Who’ll like it'), ...predictGroups(c).map((p) => {
        const g = GROUP_BY_ID.get(p.id)!;
        const mood = p.score > 0.15 ? 'pos' : p.score < -0.15 ? 'neg' : 'meh';
        return h('span', { class: `ds-who-chip ${mood}`, style: `--g:${g.color}`, 'data-tip': `${g.name} (${Math.round(city.people.share(g.id) * 100)}% of households): likely ${approvalFromScore(p.score)}% approval` }, h('i', null), g.short, h('b', null, mood === 'pos' ? '▲' : mood === 'neg' ? '▼' : '•'));
      })),
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
    const sk = this.sketchOnBoard();
    this.game.play('good');
    this.game.ui.toasts.push({ severity: 'good', icon: 'save', title: sk.refines ? 'Revision saved to the sketchbook' : 'Saved to the sketchbook', text: sk.name });
    this.renderSketches();
  }

  /** The design on the drawing board as a sketch: the same one already saved, or a new one (a revision when refining). */
  private sketchOnBoard() {
    const city = this.game.city!;
    const same = city.design.sketches.find((k) => JSON.stringify(k.input) === JSON.stringify(this.input) && k.name === (this.name.trim() || k.concept.name) && (k.refines ?? 0) === this.refining);
    return same ?? city.design.saveSketch(this.input, this.name, this.refining || undefined);
  }

  /** Replaces the prototype being refined with the new version, on the same lot. */
  private rebuild(): void {
    const city = this.game.city;
    const t = city && this.refining ? city.design.trial(this.refining) : undefined;
    if (!city || !t) return;
    if (!this.input.text.trim() && !this.input.added.length) {
      this.game.toastError('Describe a building first');
      return;
    }
    if (!city.design.canStartTrial()) {
      this.game.toastError(`Your architects can test ${MAX_ACTIVE_TRIALS} prototypes at a time`);
      return;
    }
    const sk = this.sketchOnBoard();
    const res = rebuildPrototype(city, sk.id, t.id);
    if (!res.ok) {
      this.game.audio.play('error');
      this.game.toastError(res.error ?? 'Cannot rebuild it there');
      return;
    }
    this.game.audio.play('build');
    this.game.flashMoney(-(res.cost ?? 0));
    const b = res.building!;
    this.refining = 0;
    this.close();
    this.game.world?.effects.burst(b.cx, b.y, b.cz, Math.max(b.hw, b.hd));
    this.game.flyTo(b.cx, b.cz, 220);
    this.game.select({ kind: 'building', id: b.id });
  }

  /** Builds a design as a prototype: the one on the drawing board (saved first) or one from the sketchbook. */
  private build(sketchId?: string): void {
    const city = this.game.city;
    if (!city) return;
    let id = sketchId;
    if (!id) {
      if (!this.input.text.trim() && !this.input.added.length) {
        this.game.toastError('Describe a building first');
        return;
      }
      // The same design already in the sketchbook is reused rather than saved twice.
      id = this.sketchOnBoard().id;
    }
    if (!city.design.canStartTrial()) {
      this.game.toastError(`Your architects can test ${MAX_ACTIVE_TRIALS} prototypes at a time`);
      return;
    }
    const sk = city.design.sketches.find((k) => k.id === id)!;
    if (!city.economy.canAfford(protoSpec(sk.concept).cost)) {
      this.game.toastError(`Not enough money: ${sk.name} costs ${formatMoney(protoSpec(sk.concept).cost)}`);
      return;
    }
    this.refining = 0;
    this.close();
    this.game.setTool('prototype', (t: PrototypeTool) => t.configure(sk.id));
    this.game.ui.toasts.push({ severity: 'info', icon: 'build', title: `Choose a lot for ${sk.name}`, text: 'Click beside a road to build it. R flips it to the other side of the street; Esc cancels.' });
  }

  private renderSketches(): void {
    const city = this.game.city;
    const el = this.els.sketches;
    if (!city || !el) return;
    el.innerHTML = '';
    if (!city.design.sketches.length) {
      el.append(h('div', { class: 'hint small' }, 'Designs you save appear here. Build one as a prototype to find out what people think of it.'));
      return;
    }
    for (const sk of [...city.design.sketches].reverse()) {
      const c = sk.concept;
      const img = h('img', { alt: '', draggable: 'false' }) as HTMLImageElement;
      const ready = this.game.thumbs.request(`sketch:${sk.id}`, { kind: 'building', style: c.kind, w: c.w, d: c.d, floors: c.floors, level: c.level, seed: 4242, look: c.look }, (u) => (img.src = u));
      if (ready) img.src = ready;
      el.append(h('div', { class: 'ds-sketch' },
        h('button', { class: `ds-sketch-open${sk.scrapped ? ' scrapped' : ''}`, onclick: () => this.open({ sketchId: sk.id }), 'data-tip': sk.input.text || 'Open this design' }, img, h('b', null, sk.name, sk.scrapped ? h('span', { class: 'ds-tag' }, 'scrapped') : sk.rev ? h('span', { class: 'ds-tag' }, `revision ${sk.rev}`) : null), h('span', null, c.description)),
        h('div', { class: 'ds-sketch-acts' },
          h('button', { class: 'icon-btn small', 'aria-label': `Build ${sk.name}`, 'data-tip': `Build as a prototype (${formatMoney(protoSpec(c).cost)})`, onclick: () => this.build(sk.id) }, icon('build', 13)),
          h('button', { class: 'icon-btn small', 'aria-label': 'Delete design', 'data-tip': 'Delete', onclick: () => { city.design.deleteSketch(sk.id); this.renderSketches(); } }, icon('trash', 13)),
        ),
      ));
    }
  }

  /** Prototypes being built, being tested, and their verdicts. */
  private renderTrials(b: HTMLElement): void {
    const city = this.game.city!;
    const trials = [...city.design.trials].reverse();
    b.append(h('div', { class: 'hint' }, `Build a design from your sketchbook on a real street. Once it opens, residents, neighbours and passers-by have their say for one to five months, and then you get the verdict. Your architects can test ${MAX_ACTIVE_TRIALS} at a time.`));
    if (!trials.length) {
      b.append(h('div', { class: 'tr-empty' },
        h('div', null, 'No prototypes yet.'),
        h('button', { class: 'btn primary', onclick: () => { this.tab = 'design'; this.render(); } }, icon('brush', 14), 'Design a building'),
      ));
      return;
    }
    const list = h('div', { class: 'tr-list' });
    let focus: HTMLElement | null = null;
    for (const t of trials) {
      const card = this.trialCard(t);
      if (t.id === this.focusTrial) focus = card;
      list.append(card);
    }
    b.append(list);
    if (focus) {
      const f = focus;
      f.classList.add('focus');
      requestAnimationFrame(() => f.scrollIntoView({ block: 'nearest' }));
      this.focusTrial = 0;
    }
  }

  private trialCard(t: Trial): HTMLElement {
    const city = this.game.city!;
    const c = t.concept;
    const work = c.use === 'offices' || c.use === 'shops';
    const img = h('img', { alt: '', draggable: 'false' }) as HTMLImageElement;
    const ready = this.game.thumbs.request(`trial:${t.id}`, { kind: 'building', style: c.kind, w: c.w, d: c.d, floors: c.floors, level: c.level, seed: 4242, look: c.look }, (u) => (img.src = u));
    if (ready) img.src = ready;
    const b = city.buildings.get(t.buildingId);
    const open = t.openDay >= 0;
    const col = !open ? 'var(--muted)' : t.approval >= 58 ? 'var(--good)' : t.approval >= 45 ? 'var(--warn)' : 'var(--bad)';
    const v = t.verdict;
    const sketch = city.design.sketches.find((k) => k.id === t.sketchId);
    // Months: done, current, to come.
    const monthsDone = open ? Math.min(t.months, Math.floor((city.clock.day - t.openDay) / 30)) : 0;
    const dots = h('div', { class: 'tr-months', 'data-tip': `${t.months}-month trial` }, ...Array.from({ length: t.months }, (_, i) => {
      const a = t.history[i];
      return h('span', { class: `tr-month${i < monthsDone || t.state === 'done' ? ' done' : i === monthsDone && t.state === 'testing' ? ' now' : ''}`, 'data-tip': a !== undefined ? `Month ${i + 1}: ${a}%` : `Month ${i + 1}` }, a !== undefined ? `${a}` : '');
    }));
    const head = h('div', { class: 'tr-head' },
      img,
      h('div', { class: 'tr-titles' },
        h('b', null, t.name),
        h('span', { class: 'rs-muted' }, city.design.stageOf(t)),
        h('span', { class: 'rs-muted' }, `${c.description} Built for ${formatMoney(t.cost)}.`),
        c.combos?.length ? h('div', { class: 'ds-combos' }, ...c.combos.map((id) => h('span', { class: 'ds-combo-chip' }, icon(COMBO_BY_ID.get(id)!.icon, 11), COMBO_BY_ID.get(id)!.name))) : null,
      ),
      h('div', { class: 'tr-acts' },
        b ? h('button', { class: 'btn small', onclick: () => { this.close(); this.game.flyTo(b.cx, b.cz, 220); this.game.select({ kind: 'building', id: b.id }); } }, icon('compass', 13), 'Show') : null,
        sketch ? h('button', { class: 'btn small', 'data-tip': 'Open the design in the studio', onclick: () => this.open({ sketchId: sketch.id }) }, icon('brush', 13), 'Design') : null,
      ),
    );
    const meter = h('div', { class: 'tr-meter' },
      h('div', { class: 'tr-big', style: `color:${col}` }, open ? `${t.approval}%` : '—'),
      h('div', { class: 'tr-meter-main' },
        h('div', { class: 'tr-bar' }, h('i', { style: `width:${open ? t.approval : 0}%;background:${col}` })),
        h('div', { class: 'tr-sub' }, !open ? 'Opinions start when it opens' : v ? `${GRADE_LABEL[v.grade]} · final approval` : 'approve so far'),
      ),
      dots,
    );
    const aspects = h('div', { class: 'tr-aspects' }, ...ASPECTS.map((a) => {
      const s = t.scores[a.id];
      const w = Math.abs(s) * 50;
      return h('div', { class: 'tr-aspect', 'data-tip': `${work && a.work ? a.work : a.name}: ${s > 0.15 ? 'liked' : s < -0.15 ? 'disliked' : 'no strong feelings'}` },
        h('span', null, icon(a.icon, 12), work && a.work ? a.work : a.name),
        h('div', { class: 'tr-axis' }, h('i', { class: s >= 0 ? 'pos' : 'neg', style: s >= 0 ? `left:50%;width:${w}%` : `left:${50 - w}%;width:${w}%` })),
      );
    }));
    const said = [...t.reactions].reverse().slice(0, v ? 3 : 5);
    const quotes = h('div', { class: 'tr-quotes' }, ...said.map((r) => this.quote(r)));
    const card = h('div', { class: `tr-card state-${t.state}` }, head);
    if (v) {
      card.append(h('div', { class: `tr-verdict grade-${v.grade}` },
        h('div', { class: 'tr-verdict-head' }, icon('milestone', 16), h('b', null, `Verdict: ${GRADE_LABEL[v.grade]}`), h('span', { class: 'rs-muted' }, `${v.approval}% approve`)),
        h('div', { class: 'tr-verdict-text' }, v.summary),
        v.byGroup ? this.byGroup(v.byGroup) : null,
        v.quotes.length ? h('div', { class: 'tr-quotes' }, ...v.quotes.map((r) => this.quote(r))) : null,
        v.advice.length ? h('div', { class: 'tr-advice' }, h('div', { class: 'ds-section' }, 'Your architects suggest'), ...v.advice.map((a) => h('div', { class: 'tr-advice-item' }, icon('info', 12), a))) : null,
        t.decision ? this.decided(t) : this.decide(t),
      ));
    }
    if (t.state !== 'gone') card.append(meter, aspects);
    if (said.length && !v) card.append(h('div', { class: 'ds-section' }, 'What people are saying'), quotes);
    else if (!said.length && t.state !== 'gone') card.append(h('div', { class: 'hint small' }, 'Nobody has said anything yet.'));
    return card;
  }

  /** Adopt, refine or scrap. */
  private decide(t: Trial): HTMLElement {
    const city = this.game.city!;
    const v = t.verdict!;
    const b = city.buildings.get(t.buildingId);
    const street = (b && city.roads.segments.get(b.segId)?.name) || 'its street';
    const rec = v.approval >= 58 ? 'adopt' : v.approval >= 38 ? 'refine' : 'scrap';
    const choice = (id: string, ic: string, label: string, text: string, onclick: () => void) =>
      h('button', { class: `tr-choice${rec === id ? ' rec' : ''}`, 'data-choice': id, onclick }, h('span', { class: 'tr-choice-head' }, icon(ic, 15), h('b', null, label), rec === id ? h('span', { class: 'ds-tag' }, 'suggested') : null), h('span', { class: 'tr-choice-text' }, text));
    return h('div', { class: 'tr-decide' },
      h('div', { class: 'ds-section' }, 'What now?'),
      h('div', { class: 'tr-choices' },
        choice('adopt', 'check', 'Adopt', `Your city starts building in the ${styleName(t.name)}. It spreads from ${street} ${v.approval >= 58 ? 'as people warm to it' : 'slowly, as people didn’t take to it'}.`, () => void this.adopt(t)),
        choice('refine', 'brush', 'Refine', 'Change it with what people said and test it again, for a month less.', () => this.open({ refineTrialId: t.id })),
        choice('scrap', 'trash', 'Scrap', 'Shelve the design. Keep the building as a one-off, or demolish it.', () => void this.scrap(t)),
      ),
    );
  }

  private async adopt(t: Trial): Promise<void> {
    const city = this.game.city!;
    const v = t.verdict!;
    if (v.approval < 45 && !(await this.game.ui.confirm('Adopt it anyway?', `Only ${v.approval}% of people approved of ${t.name}. Adopted, it will spread slowly, and the people living in it will be a little less happy.`, 'Adopt anyway'))) return;
    if (!city.design.adopt(t.id)) return;
    this.game.audio.play('milestone');
    this.focusTrial = t.id;
    this.render();
  }

  private async scrap(t: Trial): Promise<void> {
    const city = this.game.city!;
    const standing = !!city.buildings.get(t.buildingId);
    const buttons: [string, string, string][] = standing ? [['cancel', 'Cancel', ''], ['demolish', 'Scrap and demolish', 'danger'], ['keep', 'Scrap, keep the building', 'primary']] : [['cancel', 'Cancel', ''], ['keep', 'Scrap it', 'primary']];
    const choice = await this.game.ui.choose(`Scrap ${t.name}?`, standing ? 'The design goes back in the sketchbook, marked scrapped. The prototype can stay as a one-off, or be demolished.' : 'The design goes back in the sketchbook, marked scrapped.', buttons);
    if (choice !== 'keep' && choice !== 'demolish') return;
    city.design.scrap(t.id, choice === 'demolish');
    this.game.play(choice === 'demolish' ? 'bulldoze' : 'click');
    this.focusTrial = t.id;
    this.render();
  }

  /** What was decided. */
  private decided(t: Trial): HTMLElement {
    const city = this.game.city!;
    const d = t.decision!;
    const when = Clock.monthLabel(Math.floor(d.day / 30));
    if (d.kind === 'adopted') {
      const st = city.design.style(d.styleId ?? -1);
      const n = st ? city.design.styleCounts().get(st.id) ?? 0 : 0;
      return h('div', { class: 'tr-decided good' }, icon('check', 14), h('span', null, `Adopted in ${when} as the `, h('b', null, st?.name ?? 'city’s style'), `. ${n} building${n === 1 ? '' : 's'} so far.`),
        h('button', { class: 'btn small', onclick: () => { this.tab = 'styles'; this.render(); } }, 'City style'));
    }
    if (d.kind === 'refined') {
      const sk = city.design.sketches.find((k) => k.id === d.sketchId);
      const next = city.design.trials.find((x) => x.sketchId === d.sketchId);
      return h('div', { class: 'tr-decided' }, icon('brush', 14), h('span', null, `Refined in ${when} as `, h('b', null, sk?.name ?? 'a new version'), next ? '.' : ', not built yet.'),
        next ? h('button', { class: 'btn small', onclick: () => { this.focusTrial = next.id; this.render(); } }, 'Its trial') : sk ? h('button', { class: 'btn small', onclick: () => this.open({ sketchId: sk.id }) }, 'Open') : null);
    }
    return h('div', { class: 'tr-decided bad' }, icon('trash', 14), h('span', null, `Scrapped in ${when}.`));
  }

  /** The city's styles: its own way of building and the designs it adopted, spreading. */
  private renderStyles(b: HTMLElement): void {
    const city = this.game.city!;
    const d = city.design;
    const day = city.clock.day;
    b.append(h('div', { class: 'hint' }, 'Adopted designs become styles. Each spreads outward from the street where it was tested: new buildings nearby take it up, and owners renovate older ones in it. The better people liked it, the faster it spreads and the happier the people living in it are.'));
    const counts = d.styleCounts();
    const blend = city.style.blend();
    const share = (id: number) => blend.find((e) => e.movement.id === id)?.share ?? 0;
    const known = d.identity();
    if (known) b.append(h('div', { class: 'st-identity' }, icon('milestone', 18), h('span', null, `${city.name} is known for `, h('b', null, known.name), '.')));
    if (d.births.length) {
      b.append(h('div', { class: 'ds-section' }, 'Movements'));
      b.append(h('div', { class: 'st-list' }, ...[...d.births].reverse().map((born) => this.movementCard(born, counts))));
    } else if (d.styles.length) {
      b.append(h('div', { class: 'hint small' }, 'When the styles you adopt take hold (about a fifth of the city’s buildings) and point the same way, a movement is born: an architecture your city is known for, with a signature landmark of its own.'));
    }
    const list = h('div', { class: 'st-list' });
    const local = city.style.movements[0];
    list.append(h('div', { class: 'st-card local' },
      h('div', { class: 'st-swatch' }, icon('home', 22)),
      h('div', { class: 'st-main' },
        h('b', null, 'The city’s own way of building'),
        h('span', { class: 'rs-muted' }, local?.manifesto ?? 'How your builders build when nobody tells them otherwise.'),
        h('div', { class: 'st-stats' }, this.stat('Buildings', `${counts.get(0) ?? 0}`), this.stat('New building elsewhere', `${Math.round(share(0) * 100)}%`)),
      ),
    ));
    if (!d.styles.length) {
      list.append(h('div', { class: 'tr-empty' }, h('div', null, 'No adopted styles yet. Adopt a well-liked prototype to start one.'),
        h('button', { class: 'btn', onclick: () => { this.tab = 'prototypes'; this.render(); } }, icon('flask', 14), 'Prototypes')));
    }
    for (const st of [...d.styles].reverse()) {
      const t = d.trial(st.trialId);
      const img = h('img', { alt: '', draggable: 'false' }) as HTMLImageElement;
      if (t) {
        const c = t.concept;
        const ready = this.game.thumbs.request(`trial:${t.id}`, { kind: 'building', style: c.kind, w: c.w, d: c.d, floors: c.floors, level: c.level, seed: 4242, look: c.look }, (u) => (img.src = u));
        if (ready) img.src = ready;
      }
      const mood = moodOf(st);
      const n = counts.get(st.id) ?? 0;
      list.append(h('div', { class: `st-card${st.push === 0 ? ' retired' : ''}`, 'data-style': String(st.id) },
        img,
        h('div', { class: 'st-main' },
          h('b', null, st.name),
          h('span', { class: 'rs-muted' }, `From ${t?.name ?? 'a prototype'}${st.street ? ` on ${st.street}` : ''}, adopted ${Clock.monthLabel(Math.floor(st.day / 30))} with ${st.approval}% approval.`),
          h('div', { class: 'st-stats' },
            this.stat('Buildings', `${n}`, st.renovated ? `${st.renovated} renovated` : undefined),
            this.stat('Reaches', st.push ? `${Math.round(reachOf(st, day) / 10) * 10} m` : '—', 'from where it began'),
            this.stat('New building elsewhere', `${Math.round(globalShare(st, day) * 100)}%`),
            this.stat('Residents’ mood', `${mood >= 0 ? '+' : ''}${mood.toFixed(1)}`, mood >= 0 ? 'happier living in it' : 'less happy living in it'),
          ),
          ...(st.combos ?? []).map((id) => {
            const def = COMBO_BY_ID.get(id)!;
            return h('div', { class: 'ds-combo', 'data-tip': def.blurb }, icon(def.icon, 14), h('b', null, def.name), h('span', null, def.effect));
          }),
          h('div', { class: 'st-likes' }, ...GROUPS.map((g) => {
            const m = city.style.get(st.id);
            const like = m ? likeOf(g, m) : 0;
            const mood = like > 0.15 ? 'pos' : like < -0.15 ? 'neg' : 'meh';
            return h('span', { class: `ds-who-chip ${mood}`, style: `--g:${g.color}`, 'data-tip': `${g.name}: ${mood === 'pos' ? 'likes it' : mood === 'neg' ? 'dislikes it' : 'doesn’t mind it'}` }, h('i', null), g.short, h('b', null, mood === 'pos' ? '▲' : mood === 'neg' ? '▼' : '•'));
          })),
          h('div', { class: 'st-controls' },
            h('div', { class: 'rs-seg', role: 'group', 'aria-label': `How much to build in the ${st.name}` }, ...PUSH_LEVELS.map(([v, label]) => h('button', { class: `rs-seg-btn${st.push === v ? ' active' : ''}`, 'data-push': String(v), onclick: () => { d.setPush(st.id, v); this.game.play('click'); this.render(); } }, label))),
            h('button', { class: 'btn small', onclick: () => this.showStyle(st.id) }, icon('eye', 13), 'Show on map'),
          ),
        ),
      ));
    }
    b.append(list);
  }

  /** Approval within each taste group. */
  private byGroup(by: Partial<Record<GroupId, number>>): HTMLElement {
    return h('div', { class: 'tr-groups' }, ...GROUPS.filter((g) => by[g.id] !== undefined).map((g) => {
      const a = by[g.id]!;
      return h('div', { class: 'tr-group', 'data-tip': `${g.name}: ${a}% approve` },
        h('span', { class: 'grp-tag', style: `--g:${g.color}` }, h('i', null), g.short),
        h('div', { class: 'tr-bar' }, h('i', { style: `width:${a}%;background:${a >= 58 ? 'var(--good)' : a >= 45 ? 'var(--warn)' : 'var(--bad)'}` })),
        h('b', null, `${a}%`),
      );
    }));
  }

  /** The taste groups: who they are, how they feel, what moves them, and their petitions. */
  private renderPeople(b: HTMLElement): void {
    const city = this.game.city!;
    const people = city.people;
    const shares = people.shares();
    b.append(h('div', { class: 'hint' }, 'Every household belongs to one of six taste groups, each with its own idea of a good building. Build what a group likes and more of them move here; ignore them and they grumble, petition, protest, and in the end move away.'));
    const live = people.petitions.filter((p) => p.state === 'open' || p.state === 'promised');
    if (live.length) {
      b.append(h('div', { class: 'ds-section' }, 'Petitions'));
      b.append(h('div', { class: 'pp-petitions' }, ...live.map((p) => this.petitionCard(p))));
    }
    for (const p of people.protests) {
      const g = GROUP_BY_ID.get(p.group)!;
      b.append(h('div', { class: 'pp-protest', style: `--g:${g.color}` }, icon('people', 15), h('span', null, h('b', null, `${g.name} is protesting: “${p.sign}”`), ` ${p.why} Until ${Clock.monthLabel(Math.floor(p.until / 30))}.`),
        h('button', { class: 'btn small', onclick: () => { this.close(); this.game.flyTo(p.x, p.z, 260); } }, icon('compass', 13), 'Show')));
    }
    const grid = h('div', { class: 'pp-grid' });
    GROUPS.forEach((g, i) => {
      const st = people.state.get(g.id)!;
      const mood = Math.round(st.mood);
      const col = mood >= 58 ? 'var(--good)' : mood >= 40 ? 'var(--warn)' : 'var(--bad)';
      const t = tastesOf(g);
      const hist = [...st.history.slice(-11), mood];
      const max = 100;
      const spark = h('div', { class: 'pp-spark', 'data-tip': 'Mood, month by month' }, ...hist.map((v) => h('i', { style: `height:${Math.max(6, (v / max) * 100)}%;background:${v >= 58 ? 'var(--good)' : v >= 40 ? 'var(--warn)' : 'var(--bad)'}` })));
      grid.append(h('div', { class: `pp-card stage-${st.stage}`, style: `--g:${g.color}`, 'data-group': g.id },
        h('div', { class: 'pp-head' },
          h('div', { class: 'pp-emblem' }, icon(g.icon, 18)),
          h('div', { class: 'pp-titles' }, h('b', null, g.name), h('span', { class: 'rs-muted' }, `${Math.round(shares[i] * 100)}% of households · ${g.members}`)),
          h('span', { class: `pp-stage ${st.stage}` }, STAGE_LABEL[st.stage]),
        ),
        h('div', { class: 'pp-mood' }, h('div', { class: 'tr-big', style: `color:${col}` }, `${mood}`), h('div', { class: 'tr-meter-main' }, h('div', { class: 'tr-bar' }, h('i', { style: `width:${mood}%;background:${col}` })), h('div', { class: 'tr-sub' }, 'mood')), spark),
        h('div', { class: 'pp-blurb' }, g.blurb),
        h('div', { class: 'pp-tastes' },
          h('span', { class: 'pp-tl' }, 'Likes'), ...t.likes.map((x) => h('span', { class: 'pp-taste pos' }, x)),
        ),
        h('div', { class: 'pp-tastes' },
          h('span', { class: 'pp-tl' }, 'Dislikes'), ...t.dislikes.map((x) => h('span', { class: 'pp-taste neg' }, x)),
        ),
        h('div', { class: 'pp-drivers' }, ...people.driversOf(g.id).slice(0, 4).map((d) => h('div', { class: `pp-driver ${d.value >= 0 ? 'pos' : 'neg'}` }, h('span', null, d.why), h('b', null, `${d.value >= 0 ? '+' : '−'}${Math.abs(d.value).toFixed(0)}`)))),
        st.left || st.joined ? h('div', { class: 'rs-muted pp-moves' }, [st.joined ? `${st.joined} households moved here for the city` : '', st.left ? `${st.left} households moved away` : ''].filter(Boolean).join(' · ')) : null,
      ));
    });
    b.append(grid);
    const past = people.petitions.filter((p) => p.state !== 'open' && p.state !== 'promised').slice(-6).reverse();
    if (past.length) {
      b.append(h('div', { class: 'ds-section' }, 'Earlier petitions'));
      b.append(h('div', { class: 'pp-past' }, ...past.map((p) => {
        const g = GROUP_BY_ID.get(p.group)!;
        const what: Record<string, string> = { kept: 'Promise kept', broken: 'Promise broken', refused: 'Refused', lapsed: 'Never answered' };
        return h('div', { class: `pp-past-row ${p.state}` }, h('span', { class: 'grp-tag', style: `--g:${g.color}` }, h('i', null), g.short), h('span', null, p.text), h('b', null, what[p.state] ?? p.state));
      })));
    }
  }

  private petitionCard(p: Petition): HTMLElement {
    const city = this.game.city!;
    const g = GROUP_BY_ID.get(p.group)!;
    const day = city.clock.day;
    const done = p.state === 'promised' && city.people.fulfilled(p);
    return h('div', { class: `pp-petition ${p.state}`, style: `--g:${g.color}`, 'data-petition': String(p.id) },
      h('div', { class: 'pp-petition-head' }, h('div', { class: 'pp-emblem' }, icon(g.icon, 16)), h('b', null, g.name), h('span', { class: 'rs-muted' }, p.state === 'open' ? `asks you · ${Math.max(0, 30 - (day - p.day))} days to answer` : `you promised · ${Math.max(0, (p.deadline ?? day) - day)} days left`)),
      h('div', { class: 'pp-petition-text' }, `“${p.text}”`),
      h('div', { class: 'rs-muted' }, `Why: ${p.why.charAt(0).toLowerCase()}${p.why.slice(1)}.`),
      p.state === 'open'
        ? h('div', { class: 'btn-row' },
          h('button', { class: 'btn primary', 'data-answer': 'promise', onclick: () => { city.people.answer(p.id, true); this.game.play('good'); this.render(); } }, icon('check', 14), 'Promise'),
          h('button', { class: 'btn', 'data-answer': 'refuse', onclick: () => { city.people.answer(p.id, false); this.game.play('click'); this.render(); } }, icon('close', 14), 'Refuse'),
          h('span', { class: 'rs-muted' }, 'Keep a promise and they’ll remember it; break one and they’ll march.'))
        : h('div', { class: 'rs-muted' }, done ? 'Done: they will see it shortly.' : p.demand.kind === 'design' ? 'Design something they would like (the studio shows who will like it) and build it as a prototype.' : p.demand.kind === 'retire' ? 'Discourage or retire the style under City style.' : p.demand.kind === 'park' ? 'Build a new park.' : `Lower the tax in the Budget panel.`),
    );
  }

  /** A movement: what it stands for, what it grew from, and its signature landmark. */
  private movementCard(born: Born, counts: Map<number, number>): HTMLElement {
    const city = this.game.city!;
    const d = city.design;
    const n = born.styles.reduce((a, id) => a + (counts.get(id) ?? 0), 0);
    const m = city.style.get(born.id);
    const lm = born.landmark;
    const building = lm ? [...city.buildings.all.values()].find((x) => x.typeId === lm.serviceId) : undefined;
    let landmark: HTMLElement;
    if (building) {
      landmark = h('div', { class: 'mv-landmark' }, icon('landmark', 15), h('span', null, h('b', null, lm!.name), lm!.opened !== undefined ? ' stands as its signature building.' : ` is being built (${Math.round(building.progress * 100)}%).`),
        h('button', { class: 'btn small', onclick: () => { this.close(); this.game.flyTo(building.cx, building.cz, 320); this.game.select({ kind: 'building', id: building.id }); } }, icon('compass', 13), 'Show'));
    } else if (lm) {
      landmark = h('div', { class: 'mv-landmark' }, icon('landmark', 15), h('span', null, h('b', null, lm.name), ' is designed and waiting for a site.'),
        h('button', { class: 'btn small primary', onclick: () => this.placeLandmark(lm.serviceId, lm.name) }, icon('build', 13), 'Choose a site'));
    } else {
      landmark = h('div', { class: 'mv-forms' }, h('div', { class: 'ds-section' }, 'Commission its signature landmark'),
        h('div', { class: 'mv-form-row' }, ...(Object.keys(LANDMARK_FORMS) as LandmarkForm[]).map((f) => {
          const def = LANDMARK_FORMS[f];
          const img = h('img', { alt: '', draggable: 'false' }) as HTMLImageElement;
          if (m) {
            const ready = this.game.thumbs.request(`sig:${born.id}:${f}`, { kind: 'building', style: def.style, w: def.w, d: def.d, floors: def.floors, level: 3, seed: 4242, look: m }, (u) => (img.src = u));
            if (ready) img.src = ready;
          }
          return h('button', { class: 'mv-form', 'data-form': f, onclick: () => this.commission(born.id, f) },
            img, h('b', null, `The ${born.short} ${def.noun}`), h('span', null, def.blurb), h('span', { class: 'rs-muted' }, `${formatMoney(def.cost)} · ${formatMoney(def.tourism)}/mo in tourism`));
        })));
    }
    return h('div', { class: 'st-card movement', 'data-born': String(born.id) },
      h('div', { class: 'st-swatch mv-swatch' }, icon('milestone', 26)),
      h('div', { class: 'st-main' },
        h('b', null, born.name),
        h('span', { class: 'mv-kind' }, `${born.kind}, born ${Clock.monthLabel(Math.floor(born.day / 30))}`),
        h('span', { class: 'rs-muted mv-manifesto' }, `“${born.manifesto}”`),
        h('div', { class: 'st-stats' },
          this.stat('Buildings', `${n}`),
          this.stat('Grew from', born.styles.map((id) => d.style(id)?.name ?? '').filter(Boolean).join(', ') || '—'),
        ),
        m ? h('div', { class: 'st-likes' }, ...GROUPS.map((g) => {
          const like = likeOf(g, m);
          const mood = like > 0.15 ? 'pos' : like < -0.15 ? 'neg' : 'meh';
          return h('span', { class: `ds-who-chip ${mood}`, style: `--g:${g.color}` }, h('i', null), g.short, h('b', null, mood === 'pos' ? '▲' : mood === 'neg' ? '▼' : '•'));
        })) : null,
        landmark,
      ),
    );
  }

  private commission(bornId: number, form: LandmarkForm): void {
    const city = this.game.city!;
    const f = LANDMARK_FORMS[form];
    if (!city.economy.canAfford(f.cost)) {
      this.game.toastError(`Not enough money: it costs ${formatMoney(f.cost)}`);
      return;
    }
    const st = city.design.commission(bornId, form);
    if (!st) return;
    this.game.play('good');
    this.placeLandmark(st.id, st.name);
  }

  private placeLandmark(serviceId: string, name: string): void {
    this.close();
    this.game.setTool('place', (t: PlaceTool) => t.configure(serviceId));
    this.game.ui.toasts.push({ severity: 'info', icon: 'landmark', title: `Choose a site for ${name}`, text: 'Click beside a road. It is unique: it will also wait in the Build menu under Parks & Landmarks.' });
  }

  private stat(label: string, value: string, tip?: string): HTMLElement {
    return h('div', { class: 'st-stat', 'data-tip': tip ?? '' }, h('span', null, label), h('b', null, value));
  }

  /** Lights up every building in a style and flies to where it began. */
  private showStyle(id: number): void {
    const city = this.game.city!;
    const st = city.design.style(id);
    const w = this.game.world;
    if (!st || !w) return;
    const ids = [...city.buildings.all.values()].filter((b) => b.movement === id).map((b) => b.id);
    w.buildings.setMarks(ids, STYLE_HIGHLIGHT);
    this.close();
    this.game.flyTo(st.x, st.z, Math.min(900, Math.max(260, reachOf(st, city.clock.day) * 1.4)));
    this.game.ui.toasts.push({
      severity: 'info', icon: 'eye', title: `The ${st.name}`,
      text: `${ids.length} building${ids.length === 1 ? '' : 's'} highlighted. Press Esc or click here to clear them.`,
      onClick: () => this.game.world?.buildings.clearMarks(),
      tip: 'Click to clear the highlight',
    });
  }

  private quote(r: Trial['reactions'][number]): HTMLElement {
    const mood = r.mood >= 0.15 ? 'pos' : r.mood <= -0.15 ? 'neg' : 'meh';
    const g = r.group ? GROUP_BY_ID.get(r.group) : undefined;
    return h('div', { class: `tr-quote ${mood}${r.blame ? ' blame' : ''}`, 'data-tip': r.blame ? 'Not the design’s fault, so it counts for little' : '' },
      h('div', { class: 'tr-quote-text' }, `“${r.text}”`),
      h('div', { class: 'tr-quote-who' }, r.who, g ? h('span', { class: 'grp-tag', style: `--g:${g.color}` }, h('i', null), g.short) : null),
    );
  }

  /** Every idea: how it was learned, or how to learn it. */
  private renderIdeas(b: HTMLElement): void {
    const city = this.game.city!;
    const learned = city.design.learned;
    b.append(h('div', { class: 'hint' }, 'Your architects learn new ideas from what happens in your city. Every city’s history gives it a different toolbox.'));
    const found = city.design.found;
    b.append(h('div', { class: 'ds-section' }, `Combos · ${found.size}/${COMBOS.length}`));
    b.append(h('div', { class: 'ds-idea-grid' }, ...COMBOS.map((c) => {
      const f = found.get(c.id);
      return h('div', { class: `ds-idea combo${f ? '' : ' locked'}`, 'data-combo': c.id },
        h('div', { class: 'ds-idea-head' }, f ? icon(c.icon, 14) : icon('lock', 14), h('b', null, f ? c.name : '???')),
        h('div', { class: 'rs-muted' }, f ? c.blurb : c.hint),
        h('div', { class: 'ds-idea-how' }, f ? `${c.effect} First put together in ${f.design}.` : 'Find it by designing.'),
      );
    })));
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
