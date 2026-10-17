import { formatInt, formatMoney, formatPct } from '../core/math';
import type { Game } from '../game/Game';
import { ARCHETYPE_BY_ID } from '../sim/buildings/Archetypes';
import { GRADE_LABEL } from '../sim/design/Trials';
import { GROUPS } from '../sim/design/Tastes';
import type { Building } from '../sim/buildings/Buildings';
import type { City } from '../sim/City';
import { type Citizen, citizenOf } from '../sim/population/Citizens';
import { Errand, PauseWhy, PedState } from '../sim/walk/Pedestrians';
import { WALK_SPEED } from '../sim/walk/WalkNetwork';
import { bulldozeBuilding, bulldozeRoad, removeStop } from '../sim/CityCommands';
import { Held, Purpose, VEHICLE_MODELS } from '../sim/traffic/Vehicles';
import { POLICY_BY_ID } from '../sim/policies/Policies';
import { lineProblemText } from '../sim/transit/Transit';
import { metroProblemText } from '../sim/transit/Metro';
import { streetOf } from '../sim/CitySim';
import { ROAD_TYPES, segmentCapacity } from '../sim/roads/RoadTypes';
import { LANDFILL_CAPACITY } from '../sim/services/Coverage';
import { COVERAGE_KINDS, COVERAGE_LABEL, SERVICE_BY_ID } from '../sim/services/ServiceTypes';
import { FIELD_BY_ID } from '../sim/research/Knowledge';
import { BuildingState, Problem, ZONE_INFO, isResidential } from '../sim/types';
import type { Selection } from '../tools/InspectTool';
import { humanize } from '../tools/BulldozeTool';
import { h } from './dom';
import { icon } from './icons';

const PROBLEMS: [number, string, string][] = [
  [Problem.NoPower, 'power', 'No electricity'],
  [Problem.NoWater, 'water', 'No water'],
  [Problem.NoSewage, 'sewage', 'No sewage service'],
  [Problem.Garbage, 'garbage', 'Garbage piling up'],
  [Problem.NoRoad, 'road', 'No road access'],
  [Problem.NoWorkers, 'people', 'Not enough workers'],
  [Problem.Sickness, 'health', 'Residents are sick'],
  [Problem.Crime, 'police', 'High crime'],
  [Problem.NoGoods, 'shop', 'Short of goods'],
];

const STATE_LABEL: Record<BuildingState, string> = {
  [BuildingState.Construction]: 'Under construction',
  [BuildingState.Active]: 'Operating',
  [BuildingState.Abandoned]: 'Abandoned',
  [BuildingState.Burning]: 'On fire!',
  [BuildingState.Collapsed]: 'Collapsed',
};

function meter(v: number, color = 'var(--accent)'): HTMLElement {
  return h('div', { class: 'meter' }, h('div', { class: 'meter-fill', style: `width:${Math.round(Math.max(0, Math.min(1, v)) * 100)}%;background:${color}` }));
}

const MODEL_LABEL: Record<(typeof VEHICLE_MODELS)[number], string> = {
  sedan: 'Sedan',
  hatchback: 'Hatchback',
  suv: 'SUV',
  van: 'Panel van',
  truck: 'Freight truck',
  garbage: 'Garbage truck',
  firetruck: 'Fire engine',
  police: 'Police car',
  ambulance: 'Ambulance',
  bus: 'City bus',
  pickup: 'Pickup truck',
  taxi: 'Taxi',
  delivery: 'Delivery van',
  mini: 'Small car',
  bike: 'Cyclist',
};

/** Why a vehicle is standing still. */
const HELD_TEXT: Record<number, string> = {
  [Held.None]: 'Stopped',
  [Held.Red]: 'Waiting at a red light',
  [Held.GiveWay]: 'Giving way',
  [Held.Full]: 'Waiting for space ahead',
  [Held.Queue]: 'In a queue',
  [Held.People]: 'Letting someone cross',
};

/** What a vehicle is doing, in plain words. */
function vehicleActivity(purpose: Purpose, model: string, hour: number): string {
  switch (purpose) {
    case Purpose.Commute:
      if (model === 'bike') return hour >= 4 && hour < 12 ? 'Cycling to work' : 'Cycling home from work';
      return hour >= 4 && hour < 12 ? 'Driving to work' : 'Driving home from work';
    case Purpose.Shopping:
      return model === 'taxi' ? 'Taxi taking a shopper' : 'Out shopping';
    case Purpose.Freight:
      return 'Delivering goods';
    case Purpose.Visitor:
      return model === 'taxi' ? 'Taxi with a fare' : 'Tourist visiting the sights';
    case Purpose.MoveIn:
      return 'Moving into the city';
    case Purpose.Transit:
      return 'Carrying passengers';
    case Purpose.Emergency:
      return model === 'firetruck' ? 'Racing to a fire' : model === 'ambulance' ? 'Responding to an emergency' : 'Responding to a call';
    default:
      return model === 'garbage' ? 'Collecting garbage' : model === 'police' ? 'On patrol' : model === 'firetruck' ? 'Returning to the station' : model === 'ambulance' ? 'Returning to the hospital' : 'City service';
  }
}

/** A building as people would name it: the service's name, a house number, or the kind of place and its street. */
export function placeLabel(city: City, b: Building | undefined): string {
  if (!b) return 'somewhere that’s gone';
  const st = b.kind === 'service' ? SERVICE_BY_ID.get(b.typeId) : undefined;
  if (st) return st.name;
  const street = streetOf(city, b);
  if (isResidential(b.zone)) return `${2 * Math.floor(b.segS / 14) + (b.side > 0 ? 1 : 2)} ${street}`;
  const arch = ARCHETYPE_BY_ID.get(b.typeId);
  return `${arch ? humanize(arch.id) : 'Building'}, ${street}`;
}

const ERRAND_TEXT: Record<Errand, string> = {
  [Errand.Home]: 'Walking home',
  [Errand.Work]: 'Walking to work',
  [Errand.Shop]: 'Going shopping',
  [Errand.Park]: 'Off to the park',
  [Errand.School]: 'On the way to school',
  [Errand.Bus]: 'Walking to the bus stop',
  [Errand.Stroll]: 'Out for a stroll',
  [Errand.Lunch]: 'Popping out for lunch',
};

const ROLE_TEXT: Record<Citizen['role'], string> = {
  worker: 'Works',
  jobseeker: 'Looking for work',
  retired: 'Retired',
  student: 'Student',
  pupil: 'At school',
  child: 'Too young for school',
  carer: 'Looks after the home',
};

/** How a home's commuters travel, biggest share first ("62% drive · 30% walk"). */
function modeText(m: { walk: number; transit: number; car: number; bike?: number }): string {
  const parts: [number, string][] = [[m.car, 'drive'], [m.walk, 'walk'], [m.bike ?? 0, 'cycle'], [m.transit, 'bus or metro']];
  return parts.filter(([v]) => v >= 0.01).sort((a, b) => b[0] - a[0]).map(([v, w]) => `${Math.round(v * 100)}% ${w}`).join(' · ');
}

/** Access to jobs compared with the city's average. */
function accessWord(r: number): string {
  return r > 1.25 ? 'Many (well above average)' : r > 1.05 ? 'Above average' : r > 0.95 ? 'Average' : r > 0.75 ? 'Below average' : 'Few (well below average)';
}

const kv = (k: string, v: string | HTMLElement) => h('div', { class: 'kv' }, h('span', null, k), typeof v === 'string' ? h('b', null, v) : v);

/** Right-hand panel describing the selected building or road. */
export class Inspector {
  readonly el = h('aside', { class: 'inspector hidden' });
  private sel: Selection = null;
  private timer = 0;
  /** Who the selected person is (kept when they go indoors). */
  private person: { serial: number; who: Citizen } | null = null;

  constructor(private game: Game) {}

  show(sel: Selection): void {
    this.sel = sel;
    this.game.ui?.hud.classList.toggle('inspecting', !!sel);
    if (!sel) {
      this.el.classList.add('hidden');
      return;
    }
    this.el.classList.remove('hidden');
    this.render();
  }

  update(dt: number): void {
    if (!this.sel) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.5;
    // Don't rebuild under the cursor (keeps buttons clickable).
    if (this.el.matches(':hover')) return;
    this.render();
  }

  private header(title: string, sub: string, ic: string, chip?: HTMLElement): HTMLElement {
    return h(
      'div',
      { class: 'insp-head' },
      h('div', { class: 'insp-icon' }, icon(ic, 22)),
      h('div', { class: 'insp-titles' }, h('div', { class: 'insp-title' }, title), h('div', { class: 'insp-sub' }, sub)),
      chip ?? null,
      h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => this.game.select(null) }, icon('close', 16)),
    );
  }

  private renderPerson(city: City, i: number, serial: number): void {
    const ped = city.pedestrians;
    const alive = ped.alive(i, serial);
    if (alive && (!this.person || this.person.serial !== serial) && ped.stillHome(i)) {
      this.person = { serial, who: citizenOf(city.population, ped.household[i], ped.member[i]) };
    }
    const who = this.person && this.person.serial === serial ? this.person.who : null;
    if (!who) {
      this.game.select(null);
      return;
    }
    const name = `${who.first} ${who.family}`;
    const body = h('div', { class: 'insp-body' });
    const showBtn = (label: string, id: number, ic: string) =>
      h('button', { class: 'btn', onclick: () => this.game.select({ kind: 'building', id }) }, icon(ic, 14), label);
    if (!alive) {
      // Gone indoors, onto a bus, or out of the neighbourhood.
      const exit = ped.exits.find((x) => x.serial === serial);
      const place = exit?.building ? city.buildings.get(exit.building) : undefined;
      const text = exit?.how === 'bus' ? `${who.first} got on the bus.` : place ? `${who.first} went into ${placeLabel(city, place)}.` : `${who.first} walked out of view.`;
      this.el.appendChild(this.header(name, `${who.age} · ${exit?.how === 'bus' ? 'On the bus' : place ? 'Inside' : 'Out of view'}`, 'people'));
      body.append(h('div', { class: 'hint' }, text));
      body.appendChild(h('div', { class: 'btn-row' }, place ? showBtn('Show where', place.id, 'build') : null, city.buildings.get(who.home) ? showBtn('Home', who.home, 'home') : null));
      this.el.appendChild(body);
      return;
    }
    const act = ped.activity(i);
    const leader = ped.leader[i];
    const lead = leader >= 0 ? leader : i;
    let doing: string;
    if (act.state === PedState.WaitCross) doing = ped.waitingFor(lead) === 'lights' ? 'Waiting for the walk signal' : 'Waiting for a gap in traffic';
    else if (act.state === PedState.Pause) {
      const why = ped.pauseWhy[lead];
      doing = why === PauseWhy.Window ? 'Looking in a shop window' : why === PauseWhy.Chat ? 'Stopped for a chat' : 'Turning for home';
    } else if (act.state === PedState.Stop) doing = 'Waiting for the bus';
    else if (act.state === PedState.Linger) doing = `Spending time in ${placeLabel(city, city.buildings.get(ped.dest[lead]))}`;
    else if (act.state === PedState.Inside) doing = act.errand === Errand.Bus ? 'Getting on the bus' : 'Going inside';
    else if (act.crossing) doing = 'Crossing the road';
    else doing = ERRAND_TEXT[act.errand as Errand];
    if (leader >= 0 && ped.stillHome(leader)) doing += ` with ${citizenOf(city.population, ped.household[leader], ped.member[leader]).first}`;
    this.el.appendChild(this.header(name, `${who.age} · ${doing}`, 'people'));
    const home = city.buildings.get(who.home);
    const job = who.job ? city.buildings.get(who.job) : undefined;
    body.append(kv('Lives at', placeLabel(city, home)), kv(who.role === 'worker' ? 'Works at' : 'Day to day', who.role === 'worker' ? placeLabel(city, job) : ROLE_TEXT[who.role]));
    const destId = ped.dest[lead];
    if (act.errand === Errand.Bus) {
      const st = city.transit.stops.get(destId);
      body.append(kv('Heading to', st ? st.name : 'A bus stop'));
    } else if (act.errand !== Errand.Stroll && act.state !== PedState.Linger) {
      body.append(kv('Heading to', placeLabel(city, city.buildings.get(destId))));
    }
    if (act.remaining > 1 && act.state !== PedState.Linger) body.append(kv('Time to go', `${Math.max(1, Math.round(act.remaining / WALK_SPEED / 60))} min on foot`));
    const pop = city.population;
    const hh = ped.household[i];
    if (ped.stillHome(i)) {
      body.append(kv('Household', `${pop.size[hh]} ${pop.size[hh] === 1 ? 'person' : 'people'}`));
      const t = pop.taste[hh];
      if (t !== 255 && GROUPS[t]) body.append(kv('Sides with', GROUPS[t].short));
    }
    const following = this.game.following?.id === i && this.game.following.serial === serial;
    body.appendChild(
      h('div', { class: 'btn-row' },
        h('button', {
          class: following ? 'btn active' : 'btn',
          'data-follow': '1',
          onclick: () => {
            this.game.follow(following ? null : { id: i, serial });
            this.render();
          },
        }, icon(following ? 'close' : 'camera', 14), following ? 'Stop following' : 'Follow'),
        home ? showBtn('Home', home.id, 'home') : null,
        job ? showBtn('Work', job.id, 'office') : null,
      ),
    );
    this.el.appendChild(body);
  }

  private render(): void {
    const city = this.game.city;
    const sel = this.sel;
    if (!city || !sel) return;
    this.el.innerHTML = '';
    if (sel.kind === 'building') {
      const b = city.buildings.get(sel.id);
      if (!b) {
        this.game.select(null);
        return;
      }
      const st = b.kind === 'service' ? SERVICE_BY_ID.get(b.typeId) : undefined;
      const arch = ARCHETYPE_BY_ID.get(b.typeId);
      const centre = city.research.centers.get(b.id);
      const trial = b.typeId === 'proto' ? city.design.trialOf(b.id) : undefined;
      const title = trial ? trial.name : centre ? centre.name : st ? st.name : arch ? humanize(arch.id) : 'Building';
      const zone = b.kind === 'zoned' ? ZONE_INFO[b.zone] : null;
      const chip = zone
        ? h('span', { class: 'zone-chip', style: `--c:rgb(${zone.color.map((v) => Math.round(v * 255)).join(',')})` }, zone.short, h('span', { class: 'stars' }, '★'.repeat(b.level)))
        : undefined;
      this.el.appendChild(this.header(title, `${streetOf(city, b)}${b.district ? ` · ${city.districts.list.get(b.district)?.name ?? ''}` : ''}`, st ? 'build' : isResidential(b.zone) ? 'home' : 'office', chip));
      const body = h('div', { class: 'insp-body' });
      const stateCls = b.state === BuildingState.Burning ? 'bad' : b.state === BuildingState.Abandoned ? 'warn' : b.state === BuildingState.Construction ? 'info' : 'good';
      body.appendChild(h('div', { class: `state-pill ${stateCls}` }, STATE_LABEL[b.state], b.progress < 1 && b.state !== BuildingState.Abandoned ? ` · ${Math.round(b.progress * 100)}%` : ''));
      if (b.progress < 1) body.appendChild(meter(b.progress, 'var(--accent)'));
      if (trial) {
        const open = trial.openDay >= 0;
        const last = trial.reactions[trial.reactions.length - 1];
        const col = trial.approval >= 58 ? 'var(--good)' : trial.approval >= 45 ? 'var(--warn)' : 'var(--bad)';
        body.append(
          h('div', { class: 'insp-trial' },
            h('div', { class: 'insp-trial-head' }, icon('flask', 13), h('b', null, 'Prototype'), h('span', { class: 'muted' }, trial.verdict && !trial.decision ? `Verdict: ${GRADE_LABEL[trial.verdict.grade]}` : city.design.stageOf(trial))),
            open ? h('div', { class: 'kv' }, h('span', null, `${trial.approval}% approve`), meter(trial.approval / 100, col)) : null,
            last ? h('div', { class: 'insp-trial-quote' }, `“${last.text}”`, h('span', { class: 'muted' }, ` — ${last.who}`)) : null,
            h('div', { class: 'btn-row' }, h('button', { class: 'btn small primary', onclick: () => this.game.ui.studio.open({ tab: 'prototypes', trialId: trial.id }) }, icon('brush', 13), trial.decision ? 'See the trial' : trial.verdict ? 'Read the verdict' : 'Follow the trial')),
          ),
        );
      }
      if (b.kind === 'zoned') {
        const occ = isResidential(b.zone) ? [b.households, b.hhCap] : [b.workers, b.jobs];
        if (occ[1] > 0) {
          body.append(
            h('div', { class: 'insp-occ' },
              h('div', { class: 'insp-occ-head' }, h('span', null, isResidential(b.zone) ? 'Occupancy' : 'Staffing'), h('b', null, `${Math.round((occ[0] / occ[1]) * 100)}%`), h('span', { class: 'muted' }, `${formatInt(occ[0])} / ${formatInt(occ[1])} ${isResidential(b.zone) ? 'homes' : 'jobs'}`)),
              meter(occ[0] / occ[1], 'var(--accent)'),
            ),
          );
        }
        if (isResidential(b.zone)) {
          body.append(kv('Residents', `${formatInt(b.residents)}`));
          let employed = 0, workers = 0;
          const pop = city.population;
          for (const i of pop.householdsIn(b.id)) {
            workers += pop.workers[i];
            employed += (pop.job[i * 2] ? 1 : 0) + (pop.job[i * 2 + 1] ? 1 : 0);
          }
          if (workers) body.append(kv('Employed', `${employed} / ${workers}`));
          // How people here get around.
          const mob = city.mobility;
          const commute = mob.commuteOf(b);
          const modes = mob.modesOf(b);
          if (commute !== null && modes) body.append(kv('Commute', `${Math.round(commute)} min`), kv('Getting to work', modeText(modes)));
          const access = mob.jobAccess(b);
          const avg = mob.stats?.jobAccess ?? 0;
          if (access !== null && avg > 0) body.append(kv('Jobs within reach', accessWord(access / avg)));
          const parks = mob.parkAccess(b);
          if (parks !== null) body.append(kv('Parks within a walk', parks > 0.6 ? 'Plenty' : parks > 0.3 ? 'Some' : parks > 0.05 ? 'A few' : 'None'));
        } else {
          body.append(kv('Workers', `${b.workers} / ${b.jobs}`), kv('Efficiency', formatPct(b.efficiency)));
          const c = city.mobility.customers(b);
          const per = city.mobility.stats?.visitsPerShopJob ?? 0;
          if (c && per > 0) {
            const r = c.visits / Math.max(1, b.workers) / per;
            body.append(kv('Customers', `${formatInt(Math.round(c.visits))}/day · ${formatPct(c.walk)} on foot`), kv('Trade', r > 1.3 ? 'Busy' : r > 0.8 ? 'Steady' : r > 0.45 ? 'Quiet' : 'Struggling'));
          }
        }
        body.append(h('div', { class: 'kv' }, h('span', null, 'Happiness'), meter(b.happiness / 100, b.happiness > 60 ? 'var(--good)' : b.happiness > 35 ? 'var(--warn)' : 'var(--bad)')));
        body.append(h('div', { class: 'kv' }, h('span', null, 'Land value'), meter(b.landValue, 'var(--accent)')));
        if (b.state === BuildingState.Active) body.append(kv('Tax revenue', `${formatMoney(city.economy.buildingTax(b, city.landValue.at(b.cx, b.cz)))}/month`));
        body.append(kv('Pollution', formatPct(city.landValue.pollutionAt(b.cx, b.cz))), kv('Floors', `${b.floors}`), kv('Age', `${b.age} days`));
        const style = !trial && b.movement ? city.design.style(b.movement) : undefined;
        if (style) body.append(h('div', { class: 'kv' }, h('span', null, 'Style'), h('button', { class: 'rs-link', onclick: () => this.game.ui.studio.open({ tab: 'styles' }) }, style.name)));
        const local = b.district ? city.policies.localTo(b.district).filter((id) => !city.policies.has(id)) : [];
        if (local.length) body.append(kv('District policies', local.map((id) => POLICY_BY_ID.get(id)!.name).join(', ')));
        if (b.level < 3 && b.state === BuildingState.Active && !trial) {
          const need = b.level === 1 ? 'land value 45% and happiness 55%' : 'land value 64%, happiness 64% and good schools';
          body.appendChild(h('div', { class: 'hint small' }, `Upgrades to level ${b.level + 1} with ${need}.`));
        }
      } else if (centre) {
        const op = city.research.operational(centre);
        const a = centre.active;
        body.append(
          kv('Specialization', FIELD_BY_ID.get(centre.field)!.name),
          kv('Also works in', centre.secondary.map((f) => FIELD_BY_ID.get(f)!.name).join(', ')),
          kv('Equipment', `Level ${centre.equipment} of 3`),
          kv('Status', op.ok ? 'Operating' : op.reason ?? ''),
          kv('Upkeep', `${formatMoney(st?.upkeep ?? 0)}/month`),
        );
        if (a) {
          body.append(h('div', { class: 'section-title' }, 'Experiment'), h('div', { class: 'insp-exp' }, a.plan.title));
          body.append(h('div', { class: 'kv' }, h('span', null, a.pending ? 'Waiting for a decision' : a.status), meter(a.progress, 'var(--accent)')));
        } else body.append(h('div', { class: 'hint small' }, centre.offers.length ? `${centre.offers.length} experiments proposed. Open the research window to begin one.` : 'Proposals arrive once the centre is open and has spare power.'));
        body.append(h('div', { class: 'btn-row' }, h('button', { class: `btn ${a?.pending ? 'primary' : ''}`, onclick: () => this.game.ui.research.open({ tab: 'centres', centreId: centre.id }) }, icon('flask', 14), a?.pending ? 'Decide…' : 'Lab work…')));
      } else if (st) {
        const status = city.coverage.status.get(b.id);
        const pv = st.kind === 'park' || st.kind === 'landmark' ? city.mobility.parkVisits(b) : null;
        if (pv) {
          const load = pv.visits / pv.capacity;
          body.append(kv('Visitors', `${formatInt(Math.round(pv.visits))}/day`), kv('Crowding', load > 1 ? `Crowded (${Math.round(load * 100)}% of comfortable)` : `${Math.round(load * 100)}% of comfortable`));
        }
        if (st.designId) {
          const d = city.research.designs.get(st.designId);
          if (d) body.append(h('div', { class: 'hint small' }, `Designed by your researchers. ${d.description}`), h('div', { class: 'btn-row' }, h('button', { class: 'btn small', onclick: () => this.game.ui.research.open({ discoveryId: d.discoveryId }) }, icon('flask', 13), 'The discovery behind it')));
        }
        const retro = city.research.retrofitsFor(st.kind);
        if (retro.length) body.append(kv('Retrofitted', retro.map((o) => o.what === 'pollution' ? `${Math.round(-o.value * 100)}% less pollution` : `${Math.round(o.value * 100)}% more output`).join(', ')));
        if (st.storage) body.append(kv('Storage', `up to ${Math.round(st.storage * city.research.outputScale(st))} MW`), kv('Delivering', `${city.utilities.storage.delivered.toFixed(1)} MW across the city`));
        if (st.pollution < 0) body.append(kv('Air cleaning', `${Math.round(-st.pollution * 100)}% within ${st.radius} m`));
        if (st.radius > 0 && st.kind !== 'park') body.append(kv('Coverage radius', `${st.radius} m`));
        if (status && st.capacity > 0 && st.kind !== 'garbage' && st.kind !== 'park') {
          body.append(kv('Residents in range', formatInt(status.load)), h('div', { class: 'kv' }, h('span', null, 'Effectiveness'), meter(status.effectiveness, status.effectiveness > 0.8 ? 'var(--good)' : 'var(--warn)')));
        }
        if (st.kind === 'park') body.append(kv('Attractiveness', formatPct(st.attractiveness)));
        if (st.id === 'landfill') {
          body.append(h('div', { class: 'kv' }, h('span', null, 'Fill level'), meter(b.stock / LANDFILL_CAPACITY, b.stock > LANDFILL_CAPACITY * 0.85 ? 'var(--bad)' : 'var(--accent)')));
          if (b.stock > LANDFILL_CAPACITY * 0.85) body.appendChild(h('div', { class: 'hint small' }, 'A full landfill stops taking garbage. Build another, or a Recycling Center: spare recycling capacity also works through old landfill waste.'));
        }
        if (st.kind === 'garbage') body.append(kv('Processing', `${formatInt(st.capacity)} units/day`));
        if (st.kind === 'power' && st.output) body.append(kv('Output', `${Math.round(st.output * city.research.outputScale(st) * 10) / 10} MW`));
        if (st.id === 'metro_station') {
          const metro = city.transit.metro;
          const lines = metro.linesAt(b.id);
          body.append(kv('Waiting now', formatInt(metro.waiting.get(b.id) ?? 0)), kv('Metro lines', lines.length ? String(lines.length) : 'None'));
          for (const l of lines) {
            body.append(h('div', { class: 'kv' }, h('span', null, h('i', { class: 'swatch', style: `background:#${l.color.toString(16).padStart(6, '0')}` }), ` ${l.name}`), h('b', null, l.problem ? metroProblemText(l.problem) : `${formatInt(l.ridersPerDay)} riders/day`)));
          }
          if (!lines.length) body.appendChild(h('div', { class: 'hint small' }, 'Use the Metro Line tool to join this station to others.'));
        }
        if (st.kind === 'water' || st.kind === 'sewage') body.append(kv('Capacity', `${formatInt(st.output)} m³/day`));
        if (st.tourism) body.append(kv('Tourism', `${formatMoney(st.tourism * (0.4 + 0.6 * Math.min(1, city.stats.happiness / 100)))}/month`));
        if (st.id === 'airport') body.append(kv('Flights', 'Regional jets: one landing and one taking off each rotation'));
        if (st.id === 'cargo_port') body.append(kv('Shipping', this.game.world?.ships.status(b.id) ?? 'Opens when construction finishes'));
        const fund = (city.economy.budgets as Partial<Record<string, number>>)[st.kind];
        body.append(kv('Upkeep', `${formatMoney((st.upkeep * (fund ?? 100)) / 100)}/month`));
        if (fund !== undefined) body.append(kv('Funding', `${fund}%`));
        if (b.jobs) body.append(kv('Staff', `${b.workers} / ${b.jobs}`));
      }
      const probs = PROBLEMS.filter(([f]) => b.problems & f);
      if (probs.length) {
        body.appendChild(h('div', { class: 'section-title' }, 'Problems'));
        for (const [, ic, label] of probs) body.appendChild(h('div', { class: 'problem' }, icon(ic, 14), label));
      }
      if (b.kind === 'zoned') {
        body.appendChild(h('div', { class: 'section-title' }, 'Service access'));
        const grid = h('div', { class: 'svc-access' });
        for (const k of COVERAGE_KINDS) {
          const v = city.coverage.at(k, b.cx, b.cz);
          const cls = v > 0.6 ? 'good' : v > 0.25 ? 'warn' : 'bad';
          grid.append(h('div', { class: `svc-dot ${cls}`, 'data-tip': `${COVERAGE_LABEL[k]} coverage: ${formatPct(v)}` }, h('i'), h('span', null, COVERAGE_LABEL[k]), h('span', { class: 'muted' }, formatPct(v))));
        }
        body.appendChild(grid);
      }
      body.appendChild(
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn', onclick: () => this.game.flyTo(b.cx, b.cz, 180) }, icon('compass', 14), 'Focus'),
          h('button', { class: 'btn danger', onclick: () => { bulldozeBuilding(city, b.id); this.game.play('bulldoze'); this.game.select(null); } }, icon('bulldoze', 14), 'Demolish'),
        ),
      );
      this.el.appendChild(body);
    } else if (sel.kind === 'stop') {
      const st = city.transit.stops.get(sel.id);
      if (!st) {
        this.game.select(null);
        return;
      }
      const seg = city.roads.segments.get(st.segId);
      this.el.appendChild(this.header('Bus Stop', seg?.name || 'Unnamed road', 'stop'));
      const body = h('div', { class: 'insp-body' });
      const lines = city.transit.linesAt(st.id);
      body.append(kv('Waiting now', formatInt(st.waiting)), kv('Lines', lines.length ? String(lines.length) : 'None'));
      for (const l of lines) {
        body.append(
          h('div', { class: 'kv' },
            h('span', null, h('i', { class: 'swatch', style: `background:#${l.color.toString(16).padStart(6, '0')}` }), ` ${l.name}`),
            h('b', null, l.problem ? lineProblemText(l.problem) : `${formatInt(l.ridersPerDay)} riders/day`)),
        );
      }
      if (!lines.length) body.appendChild(h('div', { class: 'hint small' }, 'Use the Bus Line tool to add this stop to a line.'));
      body.appendChild(
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn', onclick: () => this.game.ui.openPanel('transit') }, icon('line', 14), 'Lines…'),
          h('button', { class: 'btn danger', onclick: () => { removeStop(city, st.id); this.game.play('bulldoze'); this.game.select(null); } }, icon('bulldoze', 14), 'Remove'),
        ),
      );
      this.el.appendChild(body);
    } else if (sel.kind === 'person') {
      this.renderPerson(city, sel.id, sel.serial);
    } else if (sel.kind === 'vehicle') {
      const v = city.vehicles;
      const route = v.routeOf(sel.id);
      if (!route || v.serial[sel.id] !== sel.serial) {
        this.game.select(null);
        return;
      }
      const model = VEHICLE_MODELS[v.model[sel.id]];
      const purpose = v.purpose[sel.id] as Purpose;
      const line = purpose === Purpose.Transit ? city.transit.lines.get(v.tag[sel.id]) : undefined;
      const title = line ? `${MODEL_LABEL[model]} · ${line.name}` : MODEL_LABEL[model];
      const legs = route.legs;
      const here = city.roads.segments.get(legs[Math.min(legs.length - 1, v.legOf(sel.id))].segId);
      const dest = city.roads.segments.get(legs[legs.length - 1].segId);
      this.el.appendChild(this.header(title, vehicleActivity(purpose, model, this.game.hour), model === 'bus' ? 'bus' : 'traffic'));
      const body = h('div', { class: 'insp-body' });
      const kmh = Math.round(v.speed[sel.id] * 3.6);
      const remaining = route.legs.length - v.legOf(sel.id);
      body.append(
        kv('Speed', kmh < 2 ? HELD_TEXT[v.held[sel.id]] ?? 'Stopped' : `${kmh} km/h`),
        kv('On', here?.name || 'Unnamed road'),
      );
      if (line) {
        body.append(
          kv('Next stop', dest?.name || 'Unnamed road'),
          kv('Line', `${line.stops.length} stops · ${line.buses} ${line.buses === 1 ? 'bus' : 'buses'}`),
          kv('Line ridership', `${formatInt(line.ridersPerDay)}/day`),
        );
      } else {
        body.append(kv('Heading to', dest?.name || 'Unnamed road'), kv('Route', `${remaining} ${remaining === 1 ? 'street' : 'streets'} to go`));
      }
      const following = this.game.following?.id === sel.id && this.game.following.serial === sel.serial;
      body.appendChild(
        h('div', { class: 'btn-row' },
          h('button', {
            class: following ? 'btn active' : 'btn',
            'data-follow': '1',
            onclick: () => {
              this.game.follow(following ? null : { id: sel.id, serial: sel.serial });
              this.render();
            },
          }, icon(following ? 'close' : 'camera', 14), following ? 'Stop following' : 'Follow'),
          line ? h('button', { class: 'btn', onclick: () => this.game.ui.openPanel('transit') }, icon('line', 14), 'Lines…') : null,
        ),
      );
      this.el.appendChild(body);
    } else {
      const seg = city.roads.segments.get(sel.id);
      if (!seg) {
        this.game.select(null);
        return;
      }
      const rt = ROAD_TYPES[seg.type];
      this.el.appendChild(this.header(seg.name || rt.name, rt.name, seg.type));
      const body = h('div', { class: 'insp-body' });
      const vol = city.traffic.volume.get(seg.id) ?? 0;
      const cap = segmentCapacity(rt);
      const ratio = vol / cap;
      body.append(
        kv('Length', `${Math.round(seg.length)} m`),
        kv('Lanes', `${rt.lanes * 2} · ${rt.speedKmh} km/h`),
        kv('Peak traffic', `${formatInt(vol)} / ${formatInt(cap)} veh/h`),
        h('div', { class: 'kv' }, h('span', null, 'Congestion'), meter(Math.min(1, ratio), ratio > 1 ? 'var(--bad)' : ratio > 0.7 ? 'var(--warn)' : 'var(--good)')),
        kv('Vehicles now', formatInt(city.vehicles.countOn(seg.id))),
        kv('Buildings served', formatInt(city.buildings.onSegment(seg.id).length)),
        kv('Upkeep', `${formatMoney(seg.length * rt.upkeepPerMeter)}/month`),
      );
      if (ratio > 1) body.appendChild(h('div', { class: 'hint small' }, 'Over capacity: add parallel routes or upgrade to a wider road.'));
      body.appendChild(
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn', onclick: () => { this.game.ui.toolbar.select('roads'); } }, icon('upgrade', 14), 'Upgrade…'),
          h('button', { class: 'btn danger', onclick: () => { bulldozeRoad(city, seg.id); this.game.play('bulldoze'); this.game.select(null); } }, icon('bulldoze', 14), 'Remove'),
        ),
      );
      this.el.appendChild(body);
    }
  }
}
