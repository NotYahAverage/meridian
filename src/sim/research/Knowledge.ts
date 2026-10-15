/**
 * The rules discoveries are generated from: scientific fields, the substances
 * a civilization can work with, and the methods (principles) that turn a
 * substance into knowledge. None of these is a discovery by itself — what a
 * civilization ends up with depends on which substances it has, which methods
 * its centres can reach, the decisions taken during experiments and what it
 * already knows (knowledge tags).
 */

export type FieldId = 'materials' | 'energy' | 'agriculture' | 'manufacturing' | 'transport' | 'water' | 'environment' | 'architecture' | 'medicine';

export interface FieldDef {
  id: FieldId;
  name: string;
  /** Hex colour for chips and accents. */
  color: number;
  icon: string;
  /** Fields whose ideas most often spill over (unexpected discoveries land here). */
  near: FieldId[];
}

export const FIELDS: FieldDef[] = [
  { id: 'materials', name: 'Materials & Construction', color: 0xc08a4a, icon: 'build', near: ['architecture', 'manufacturing', 'energy'] },
  { id: 'energy', name: 'Energy', color: 0xe0a020, icon: 'power', near: ['materials', 'environment', 'manufacturing'] },
  { id: 'agriculture', name: 'Agriculture & Food', color: 0x6aa84f, icon: 'tree', near: ['environment', 'water', 'medicine'] },
  { id: 'manufacturing', name: 'Manufacturing', color: 0x8e9aa6, icon: 'factory', near: ['materials', 'energy', 'transport'] },
  { id: 'transport', name: 'Transport & Infrastructure', color: 0x5b8def, icon: 'road', near: ['manufacturing', 'architecture', 'materials'] },
  { id: 'water', name: 'Water & Sanitation', color: 0x3fa0d0, icon: 'water', near: ['environment', 'medicine', 'agriculture'] },
  { id: 'environment', name: 'Environmental Engineering', color: 0x2f9e6f, icon: 'tree', near: ['water', 'energy', 'agriculture'] },
  { id: 'architecture', name: 'Architecture & Planning', color: 0xb07cc6, icon: 'office', near: ['materials', 'transport', 'environment'] },
  { id: 'medicine', name: 'Medicine & Public Health', color: 0xd9534f, icon: 'health', near: ['water', 'agriculture', 'environment'] },
];

export const FIELD_BY_ID = new Map(FIELDS.map((f) => [f.id, f]));

/**
 * The fields research still works in. Architecture and the city's look now
 * belong to the Design Studio; research is a side branch for the city's
 * utilities: power, water and waste. The other fields stay defined so older
 * cities' discoveries still read and work as they did.
 */
export const LIVE_FIELDS: FieldId[] = ['energy', 'water', 'environment'];
export const LIVE_FIELD_DEFS = FIELDS.filter((f) => LIVE_FIELDS.includes(f.id));
export const isLiveField = (f: FieldId): boolean => LIVE_FIELDS.includes(f);

/** Physical properties of a substance, each 0–1. */
export type Prop = 'strength' | 'conductivity' | 'porosity' | 'energy' | 'fertility' | 'purity' | 'renewable';

export type SurfaceLook = 'brick' | 'stone' | 'concrete' | 'timber' | 'metal' | 'glass' | 'render' | 'green';

export interface ResourceDef {
  id: string;
  name: string;
  /** Used in generated names ("Brine", "Fired-clay"). */
  adj: string;
  props: Partial<Record<Prop, number>>;
  /** Where it comes from, for the interface. */
  source: string;
  /** Only usable by a research centre close to it (otherwise anywhere in the city). */
  local?: boolean;
  /** How buildings made with it tend to look. */
  look: { color: number; surface: SurfaceLook };
  /** A flow of energy rather than a material: only methods that name it can use it. */
  flux?: boolean;
}

export const RESOURCES: ResourceDef[] = [
  { id: 'clay', name: 'Clay', adj: 'Fired-clay', props: { strength: 0.5, porosity: 0.6, fertility: 0.3, purity: 0.4 }, source: 'Clay beds by the water', look: { color: 0xa8603e, surface: 'brick' } },
  { id: 'silt', name: 'River silt', adj: 'Silt', props: { fertility: 0.85, porosity: 0.5, purity: 0.3 }, source: 'The river banks', look: { color: 0x9c8a6a, surface: 'render' } },
  { id: 'reeds', name: 'Reeds', adj: 'Reed-fibre', props: { renewable: 0.9, fertility: 0.4, porosity: 0.7, strength: 0.25 }, source: 'Marshy shallows', look: { color: 0xb8a06a, surface: 'timber' } },
  { id: 'granite', name: 'Granite', adj: 'Granite', props: { strength: 0.95, purity: 0.5, porosity: 0.1 }, source: 'Upland quarries', look: { color: 0x8f8b86, surface: 'stone' } },
  { id: 'mica', name: 'Mica', adj: 'Mica', props: { conductivity: 0.45, purity: 0.85, strength: 0.3 }, source: 'A mica seam in the hills', look: { color: 0x9aa6b0, surface: 'glass' } },
  { id: 'sand', name: 'Silica sand', adj: 'Silica', props: { purity: 0.75, porosity: 0.45, strength: 0.3 }, source: 'Beaches and dunes', look: { color: 0x6d8fa8, surface: 'glass' } },
  { id: 'kelp', name: 'Kelp', adj: 'Kelp', props: { renewable: 0.95, fertility: 0.7, energy: 0.35 }, source: 'Kelp beds off the shore', local: true, look: { color: 0x5d7a4a, surface: 'green' } },
  { id: 'brine', name: 'Brine', adj: 'Brine', props: { conductivity: 0.85, purity: 0.2, porosity: 0.3 }, source: 'Salt water', look: { color: 0xd8d6cf, surface: 'concrete' } },
  { id: 'shell_lime', name: 'Shell lime', adj: 'Shell-lime', props: { strength: 0.6, porosity: 0.35, purity: 0.55 }, source: 'Shell banks on the coast', look: { color: 0xe5dccb, surface: 'render' } },
  { id: 'peat', name: 'Peat', adj: 'Peat', props: { energy: 0.55, porosity: 0.8, fertility: 0.5 }, source: 'Bogs around the lakes', look: { color: 0x6a5a48, surface: 'brick' } },
  { id: 'timber', name: 'Timber', adj: 'Laminated-timber', props: { strength: 0.55, renewable: 0.8, energy: 0.4 }, source: 'The forests', look: { color: 0x9a6b42, surface: 'timber' } },
  { id: 'limestone', name: 'Limestone', adj: 'Limestone', props: { strength: 0.7, purity: 0.45, porosity: 0.3 }, source: 'Limestone outcrops', look: { color: 0xd6cfbf, surface: 'stone' } },
  { id: 'basalt', name: 'Basalt', adj: 'Basalt', props: { strength: 0.9, conductivity: 0.2, purity: 0.3 }, source: 'A basalt deposit', look: { color: 0x4e4f52, surface: 'stone' } },
  { id: 'copper', name: 'Copper ore', adj: 'Copper', props: { conductivity: 0.95, strength: 0.5, purity: 0.4 }, source: 'A copper lode', look: { color: 0xb87333, surface: 'metal' } },
  { id: 'geothermal', name: 'Geothermal heat', adj: 'Geothermal', props: { energy: 0.8, renewable: 0.9, purity: 0.6 }, source: 'Hot rock not far underground', look: { color: 0x9a5b45, surface: 'concrete' }, flux: true },
  { id: 'coal_ash', name: 'Fly ash', adj: 'Fly-ash', props: { porosity: 0.6, strength: 0.45, purity: 0.1 }, source: 'The coal power plant', look: { color: 0x707276, surface: 'concrete' } },
  { id: 'slag', name: 'Furnace slag', adj: 'Slag', props: { strength: 0.75, conductivity: 0.3, purity: 0.2 }, source: 'The industrial district', local: true, look: { color: 0x5f6266, surface: 'metal' } },
  { id: 'cullet', name: 'Recycled glass', adj: 'Recycled-glass', props: { purity: 0.8, strength: 0.4, porosity: 0.2 }, source: 'The recycling system', look: { color: 0x5e8a86, surface: 'glass' } },
  { id: 'compost', name: 'Compost', adj: 'Bio-compost', props: { fertility: 0.9, energy: 0.4, renewable: 0.8 }, source: 'Gardens, parks and green waste', look: { color: 0x6f8a45, surface: 'green' } },
  { id: 'refuse_gas', name: 'Landfill gas', adj: 'Landfill-gas', props: { energy: 0.7, renewable: 0.5, purity: 0.2 }, source: 'The landfill', look: { color: 0x8a8f72, surface: 'metal' } },
  { id: 'sunlight', name: 'Sunlight', adj: 'Solar', props: { energy: 0.5, renewable: 1, purity: 1 }, source: 'Everywhere', look: { color: 0x3d4b5a, surface: 'glass' }, flux: true },
  { id: 'wind', name: 'Wind', adj: 'Aeolian', props: { energy: 0.45, renewable: 1, purity: 0.9 }, source: 'Everywhere, strongest on open ground', look: { color: 0xe8e6e0, surface: 'metal' }, flux: true },
  { id: 'tidal', name: 'Tidal flow', adj: 'Tidal', props: { energy: 0.65, renewable: 1, purity: 0.8 }, source: 'Open water by the shore', local: true, look: { color: 0x2e6f9a, surface: 'concrete' }, flux: true },
  { id: 'groundwater', name: 'Groundwater', adj: 'Aquifer', props: { purity: 0.65, porosity: 0.5 }, source: 'Wells anywhere', look: { color: 0x1e7fb8, surface: 'concrete' } },
];

export const RESOURCE_BY_ID = new Map(RESOURCES.map((r) => [r.id, r]));

/** Substances one civilization may find in its land (two are chosen by its seed). */
export const DEPOSITS = ['basalt', 'copper', 'geothermal', 'mica', 'clay', 'limestone', 'peat'];

/** What a generated building does (maps onto the city's existing systems). */
export type FunctionKind = 'powerGen' | 'storage' | 'water' | 'sewage' | 'waste' | 'farm' | 'scrubber' | 'clinic' | 'school' | 'civic';

/** City-wide effects a refined method can have. */
export type ModifierKind =
  | 'buildCost' | 'powerUse' | 'waterUse' | 'garbage' | 'roadCapacity' | 'industryEfficiency'
  | 'industryPollution' | 'powerPollution' | 'happiness' | 'landValue' | 'boost';

/** Architectural components and materials later designs can use. */
export type ComponentKind = 'glass' | 'stone' | 'timber' | 'brick' | 'gardenRoof' | 'solarRoof' | 'tallFrame' | 'fins' | 'dome';

/** Equipment shapes a principle stamps on the buildings it leads to. */
export type ModuleKind =
  | 'stack' | 'tank' | 'sphere' | 'cooling' | 'solarArray' | 'rotor' | 'mast' | 'dome' | 'cellRack' | 'coilTower'
  | 'greenhouse' | 'silo' | 'basin' | 'finTower' | 'turbineHouse' | 'pipes' | 'canopy' | 'pitch' | 'fountain';

export interface Principle {
  id: string;
  field: FieldId;
  /** Name of the method ("Electrochemical storage"). */
  name: string;
  /** Nouns for methods named after it ("Binder Process"). */
  nouns: string[];
  /** Nouns for facilities it leads to ("Turbine Yard"). */
  facilities?: string[];
  /** A theory's name ("Electrolyte Principle"). */
  theory: string;
  /** How much each substance property matters (fit). */
  prefers: Partial<Record<Prop, number>>;
  /** Knowledge needed before it can be tried. */
  needs?: string[];
  /** Knowledge it provides when it pays off. */
  gives: string[];
  /** A facility it can be scaled into. */
  build?: FunctionKind;
  /** A method it can be refined into. */
  mod?: ModifierKind;
  /** A component or material it can be refined into. */
  comp?: ComponentKind;
  /** Substances it can only work with (otherwise any that fit). */
  only?: string[];
  /** Equipment that marks buildings derived from it. */
  modules: ModuleKind[];
  /** 0–1: how hard it is (raises risk and cost). */
  difficulty: number;
  /** Lab equipment level needed. */
  tier: 1 | 2 | 3;
}

export const PRINCIPLES: Principle[] = [
  // ── Energy ──
  { id: 'combustion', field: 'energy', name: 'Clean combustion', nouns: ['Furnace', 'Burner Plant', 'Firing Station'], facilities: ['Furnace Plant', 'Burner Station', 'Firing Station'], theory: 'Flame Chemistry', prefers: { energy: 1, purity: 0.4 }, only: ['peat', 'timber', 'refuse_gas', 'compost', 'kelp', 'reeds'], gives: ['thermal'], build: 'powerGen', mod: 'powerPollution', modules: ['stack', 'turbineHouse'], difficulty: 0.2, tier: 1 },
  { id: 'photonic', field: 'energy', name: 'Photonic harvesting', nouns: ['Array', 'Light Farm', 'Photon Field'], facilities: ['Light Farm', 'Photon Field', 'Solar Array'], theory: 'Photoelectric Law', prefers: { purity: 0.8, conductivity: 0.6 }, only: ['sunlight', 'mica', 'sand', 'cullet', 'copper'], gives: ['optical'], build: 'powerGen', comp: 'solarRoof', modules: ['solarArray'], difficulty: 0.3, tier: 1 },
  { id: 'kinetic', field: 'energy', name: 'Kinetic capture', nouns: ['Rotor Park', 'Turbine Yard', 'Current Mill'], facilities: ['Turbine Yard', 'Rotor Park', 'Current Mill'], theory: 'Flow Dynamics', prefers: { energy: 0.8, renewable: 0.8 }, only: ['wind', 'tidal'], gives: ['flow'], build: 'powerGen', modules: ['rotor', 'turbineHouse'], difficulty: 0.25, tier: 1 },
  { id: 'cells', field: 'energy', name: 'Electrochemical cells', nouns: ['Cell Bank', 'Charge Vault', 'Flow Battery'], facilities: ['Cell Bank', 'Charge Vault', 'Battery Hall'], theory: 'Electrolyte Principle', prefers: { conductivity: 1, porosity: 0.4 }, gives: ['electrolyte'], build: 'storage', mod: 'boost', modules: ['cellRack', 'coilTower'], difficulty: 0.35, tier: 1 },
  { id: 'thermal_store', field: 'energy', name: 'Thermal mass storage', nouns: ['Heat Bank', 'Thermal Vault', 'Stone Battery'], facilities: ['Heat Bank', 'Thermal Vault', 'Stone Battery'], theory: 'Heat Retention Law', prefers: { strength: 0.6, energy: 0.5, porosity: 0.3 }, only: ['granite', 'basalt', 'limestone', 'clay', 'sand', 'slag', 'geothermal', 'shell_lime'], needs: ['thermal'], gives: ['thermal', 'storage'], build: 'storage', modules: ['silo', 'sphere'], difficulty: 0.3, tier: 1 },
  { id: 'deep_heat', field: 'energy', name: 'Deep heat extraction', nouns: ['Heat Mine', 'Thermal Station', 'Steam Field'], facilities: ['Heat Mine', 'Thermal Station', 'Steam Field'], theory: 'Crustal Heat Model', prefers: { energy: 1, renewable: 0.6 }, only: ['geothermal', 'granite', 'basalt'], needs: ['thermal'], gives: ['thermal', 'deep'], build: 'powerGen', modules: ['cooling', 'pipes'], difficulty: 0.5, tier: 2 },
  { id: 'superconduct', field: 'energy', name: 'Low-loss conduction', nouns: ['Grid Method', 'Line Process'], facilities: ['Charge Vault', 'Grid Store'], theory: 'Resistance Collapse', prefers: { conductivity: 1, purity: 0.6 }, needs: ['electrolyte', 'lattice'], gives: ['conduction'], mod: 'powerUse', build: 'storage', modules: ['coilTower', 'cellRack'], difficulty: 0.6, tier: 2 },
  // ── Materials ──
  { id: 'sintering', field: 'materials', name: 'Sintering', nouns: ['Process', 'Firing Method', 'Ceramic'], theory: 'Grain Fusion Theory', prefers: { strength: 0.8, purity: 0.4, porosity: 0.3 }, gives: ['ceramic'], mod: 'buildCost', comp: 'brick', modules: ['stack', 'silo'], difficulty: 0.2, tier: 1 },
  { id: 'binders', field: 'materials', name: 'Binder chemistry', nouns: ['Cement', 'Binder Process', 'Mortar'], theory: 'Hydration Law', prefers: { porosity: 0.7, strength: 0.6 }, gives: ['binder'], mod: 'buildCost', comp: 'stone', modules: ['silo', 'pipes'], difficulty: 0.15, tier: 1 },
  { id: 'lattice', field: 'materials', name: 'Lattice composites', nouns: ['Composite', 'Fibre Frame', 'Lattice'], theory: 'Lattice Stiffness Principle', prefers: { strength: 1, renewable: 0.3 }, needs: ['binder'], gives: ['lattice'], comp: 'tallFrame', mod: 'buildCost', modules: ['mast'], difficulty: 0.4, tier: 2 },
  { id: 'glazing', field: 'materials', name: 'Advanced glazing', nouns: ['Glazing', 'Glass', 'Pane'], theory: 'Optical Clarity Law', prefers: { purity: 1, strength: 0.3 }, only: ['sand', 'cullet', 'mica', 'shell_lime'], gives: ['optical', 'ceramic'], comp: 'glass', mod: 'landValue', modules: ['canopy'], difficulty: 0.3, tier: 1 },
  { id: 'engineered_wood', field: 'materials', name: 'Engineered wood', nouns: ['Laminate', 'Timber Frame', 'Glulam'], theory: 'Fibre Bonding Principle', prefers: { renewable: 0.8, strength: 0.6 }, only: ['timber', 'reeds', 'kelp'], needs: ['binder'], gives: ['lattice', 'bio'], comp: 'timber', mod: 'buildCost', modules: ['canopy'], difficulty: 0.3, tier: 1 },
  // ── Manufacturing ──
  { id: 'automation', field: 'manufacturing', name: 'Process automation', nouns: ['Line', 'Automaton Method', 'Control System'], theory: 'Feedback Control Theory', prefers: { conductivity: 0.7, strength: 0.4 }, gives: ['control'], mod: 'industryEfficiency', modules: ['turbineHouse', 'pipes'], difficulty: 0.35, tier: 1 },
  { id: 'heat_recovery', field: 'energy', name: 'Process heat recovery', nouns: ['Recuperator', 'Heat Loop'], facilities: ['Heat Recovery Plant', 'Recuperator Station'], theory: 'Waste Heat Principle', prefers: { energy: 0.5, strength: 0.5 }, only: ['geothermal', 'slag', 'coal_ash', 'granite', 'basalt', 'copper'], needs: ['thermal'], gives: ['thermal', 'control'], mod: 'industryPollution', build: 'powerGen', modules: ['pipes', 'stack'], difficulty: 0.3, tier: 1 },
  { id: 'casting', field: 'manufacturing', name: 'Precision casting', nouns: ['Casting', 'Foundry Method'], theory: 'Solidification Model', prefers: { strength: 0.7, conductivity: 0.5, purity: 0.3 }, only: ['slag', 'copper', 'basalt', 'coal_ash', 'granite'], gives: ['metallurgy'], mod: 'buildCost', comp: 'fins', modules: ['stack', 'turbineHouse'], difficulty: 0.35, tier: 1 },
  { id: 'reclamation', field: 'environment', name: 'Material reclamation', nouns: ['Reclaimer', 'Recovery Works', 'Sorting Hall'], facilities: ['Reclaimer', 'Recovery Works', 'Sorting Hall'], theory: 'Closed Loop Principle', prefers: { purity: 0.3, strength: 0.4, energy: 0.3 }, only: ['cullet', 'slag', 'coal_ash', 'refuse_gas', 'compost'], gives: ['loop'], build: 'waste', mod: 'garbage', modules: ['turbineHouse', 'silo'], difficulty: 0.3, tier: 1 },
  // ── Agriculture ──
  { id: 'hydroponics', field: 'agriculture', name: 'Hydroponics', nouns: ['Grow House', 'Vertical Farm', 'Glass Farm'], facilities: ['Grow House', 'Vertical Farm', 'Glass Farm'], theory: 'Root Uptake Model', prefers: { fertility: 0.7, purity: 0.5 }, gives: ['bio'], build: 'farm', mod: 'happiness', modules: ['greenhouse', 'tank'], difficulty: 0.3, tier: 1 },
  { id: 'soil', field: 'agriculture', name: 'Soil enrichment', nouns: ['Soil Method', 'Humus Process'], facilities: ['Market Garden', 'Farmstead', 'Allotment Hall'], theory: 'Soil Biome Theory', prefers: { fertility: 1, porosity: 0.4 }, gives: ['bio'], mod: 'happiness', build: 'farm', modules: ['greenhouse', 'silo'], difficulty: 0.2, tier: 1 },
  { id: 'fermentation', field: 'environment', name: 'Fermentation', nouns: ['Digester', 'Ferment Works', 'Biogas Plant'], facilities: ['Digester Plant', 'Biogas Works', 'Ferment Works'], theory: 'Microbial Conversion', prefers: { fertility: 0.6, energy: 0.6, renewable: 0.5 }, gives: ['bio', 'biofilm'], build: 'powerGen', mod: 'garbage', modules: ['sphere', 'tank'], difficulty: 0.3, tier: 1 },
  // ── Water ──
  { id: 'membranes', field: 'water', name: 'Membrane filtration', nouns: ['Filter Works', 'Membrane Plant'], facilities: ['Filter Works', 'Membrane Plant'], theory: 'Selective Permeability', prefers: { porosity: 0.8, purity: 0.6 }, gives: ['membrane'], build: 'water', mod: 'waterUse', modules: ['tank', 'basin'], difficulty: 0.3, tier: 1 },
  { id: 'bio_treatment', field: 'water', name: 'Biological treatment', nouns: ['Reed Beds', 'Treatment Works', 'Bio-Reactor'], facilities: ['Reed Beds', 'Treatment Works', 'Bio-Reactor'], theory: 'Biofilm Digestion', prefers: { fertility: 0.6, porosity: 0.6, renewable: 0.4 }, gives: ['biofilm'], build: 'sewage', modules: ['basin', 'tank'], difficulty: 0.25, tier: 1 },
  { id: 'desal', field: 'water', name: 'Desalination', nouns: ['Desal Plant', 'Brine Works'], facilities: ['Desalination Plant', 'Salt Works'], theory: 'Osmotic Pressure Law', prefers: { conductivity: 0.5, purity: 0.5 }, only: ['brine', 'tidal', 'groundwater'], needs: ['membrane'], gives: ['membrane', 'flow'], build: 'water', modules: ['tank', 'pipes'], difficulty: 0.45, tier: 2 },
  { id: 'conservation', field: 'water', name: 'Water conservation', nouns: ['Fixture Standard', 'Reuse System'], theory: 'Greywater Cycle', prefers: { purity: 0.4, porosity: 0.5 }, gives: ['loop'], mod: 'waterUse', modules: ['tank'], difficulty: 0.15, tier: 1 },
  // ── Environment ──
  { id: 'scrubbing', field: 'environment', name: 'Air scrubbing', nouns: ['Scrubber Tower', 'Air Works', 'Filter Mast'], facilities: ['Scrubber Station', 'Air Works', 'Filter Masts'], theory: 'Adsorption Principle', prefers: { porosity: 1, purity: 0.3 }, gives: ['adsorb'], build: 'scrubber', mod: 'industryPollution', modules: ['finTower'], difficulty: 0.3, tier: 1 },
  { id: 'capture', field: 'environment', name: 'Emission capture', nouns: ['Capture Process', 'Flue Method'], facilities: ['Capture Station', 'Clean Air Works'], theory: 'Carbon Binding Theory', prefers: { porosity: 0.7, strength: 0.3 }, needs: ['adsorb'], gives: ['adsorb', 'thermal'], mod: 'powerPollution', build: 'scrubber', modules: ['finTower', 'pipes'], difficulty: 0.4, tier: 2 },
  { id: 'rewilding', field: 'environment', name: 'Urban ecology', nouns: ['Wild Park', 'Green Corridor', 'Biotope'], facilities: ['Wild Park', 'Green Corridor', 'Biotope'], theory: 'Habitat Network Model', prefers: { fertility: 0.7, renewable: 0.7 }, gives: ['bio', 'habitat'], build: 'farm', comp: 'gardenRoof', modules: ['greenhouse'], difficulty: 0.2, tier: 1 },
  // ── Transport ──
  { id: 'pavements', field: 'transport', name: 'Pavement science', nouns: ['Surface', 'Pavement Method'], theory: 'Load Distribution Law', prefers: { strength: 1, porosity: 0.3 }, gives: ['surface'], mod: 'roadCapacity', modules: ['canopy'], difficulty: 0.25, tier: 1 },
  { id: 'signals', field: 'transport', name: 'Signal logic', nouns: ['Signal System', 'Flow Control'], theory: 'Traffic Wave Theory', prefers: { conductivity: 0.9 }, needs: ['control'], gives: ['control'], mod: 'roadCapacity', modules: ['mast'], difficulty: 0.35, tier: 1 },
  // ── Architecture ──
  { id: 'passive', field: 'architecture', name: 'Passive design', nouns: ['Shading Standard', 'Passive House Method'], theory: 'Thermal Comfort Model', prefers: { porosity: 0.5, strength: 0.5 }, gives: ['envelope'], mod: 'powerUse', comp: 'fins', modules: ['canopy'], difficulty: 0.2, tier: 1 },
  { id: 'civic_design', field: 'architecture', name: 'Civic design', nouns: ['Forum', 'Pavilion', 'Civic Hall'], facilities: ['Forum', 'Pavilion', 'Civic Hall'], theory: 'Public Realm Theory', prefers: { strength: 0.6, purity: 0.5 }, needs: ['ceramic'], gives: ['civic'], build: 'civic', mod: 'landValue', comp: 'dome', modules: ['dome', 'canopy'], difficulty: 0.35, tier: 1 },
  { id: 'vertical', field: 'architecture', name: 'Vertical planning', nouns: ['Height Code', 'Density Plan'], theory: 'Urban Density Model', prefers: { strength: 0.9 }, needs: ['lattice'], gives: ['envelope'], mod: 'landValue', comp: 'tallFrame', modules: ['mast'], difficulty: 0.45, tier: 2 },
  { id: 'learning', field: 'architecture', name: 'Learning spaces', nouns: ['Academy', 'Study Hall', 'Learning Centre'], facilities: ['Academy', 'Study Hall', 'Learning Centre'], theory: 'Spatial Pedagogy', prefers: { purity: 0.6, strength: 0.4 }, needs: ['envelope'], gives: ['civic'], build: 'school', modules: ['canopy', 'dome'], difficulty: 0.3, tier: 1 },
  // ── Medicine ──
  { id: 'diagnostics', field: 'medicine', name: 'Diagnostics', nouns: ['Clinic', 'Diagnostic Centre', 'Care Hall'], facilities: ['Clinic', 'Diagnostic Centre', 'Care Hall'], theory: 'Early Detection Principle', prefers: { purity: 0.8, conductivity: 0.4 }, gives: ['clinical'], build: 'clinic', mod: 'happiness', modules: ['canopy'], difficulty: 0.3, tier: 1 },
  { id: 'hygiene', field: 'medicine', name: 'Public hygiene', nouns: ['Sanitation Method', 'Hygiene Code'], theory: 'Contagion Theory', prefers: { purity: 0.6, porosity: 0.4 }, gives: ['clinical', 'loop'], mod: 'garbage', modules: ['tank'], difficulty: 0.2, tier: 1 },
  { id: 'pharma', field: 'medicine', name: 'Natural remedies', nouns: ['Remedy', 'Infusion', 'Apothecary'], facilities: ['Apothecary', 'Remedy House', 'Herbal Clinic'], theory: 'Active Compound Theory', prefers: { fertility: 0.8, purity: 0.5 }, needs: ['bio'], gives: ['clinical', 'bio'], mod: 'happiness', build: 'clinic', modules: ['greenhouse'], difficulty: 0.35, tier: 1 },
];

export const PRINCIPLE_BY_ID = new Map(PRINCIPLES.map((p) => [p.id, p]));

/** Friendly names for knowledge tags. */
export const TAG_NAMES: Record<string, string> = {
  thermal: 'heat handling', optical: 'optics', flow: 'flow dynamics', electrolyte: 'electrolytes', storage: 'energy storage', deep: 'deep drilling',
  conduction: 'low-loss conduction', ceramic: 'ceramics', binder: 'binders', lattice: 'lattice structures', bio: 'biology', control: 'control systems',
  metallurgy: 'metallurgy', loop: 'reuse loops', biofilm: 'biofilms', membrane: 'membranes', adsorb: 'adsorption', habitat: 'habitats',
  surface: 'surface engineering', envelope: 'building envelopes', civic: 'civic design', clinical: 'clinical science',
};

/** How well a substance suits a method (0–1). */
export function fit(p: Principle, r: ResourceDef): number {
  if (p.only && !p.only.includes(r.id)) return 0;
  // Sunlight, wind, tides and heat aren't materials: only methods built for them can use them.
  if (r.flux && !p.only?.includes(r.id)) return 0;
  let s = 0, w = 0;
  for (const [k, v] of Object.entries(p.prefers) as [Prop, number][]) {
    s += (r.props[k] ?? 0) * v;
    w += v;
  }
  return w > 0 ? s / w : 0;
}

/** The kind of facility a function becomes, for prose. */
export const FUNCTION_LABEL: Record<FunctionKind, string> = {
  powerGen: 'power station',
  storage: 'energy-storage facility',
  water: 'water works',
  sewage: 'wastewater works',
  waste: 'waste-processing plant',
  farm: 'urban farm',
  scrubber: 'air-cleaning station',
  clinic: 'health centre',
  school: 'learning centre',
  civic: 'civic landmark',
};

export const MODIFIER_LABEL: Record<ModifierKind, string> = {
  buildCost: 'construction costs',
  powerUse: 'electricity use',
  waterUse: 'water use',
  garbage: 'garbage produced',
  roadCapacity: 'road capacity',
  industryEfficiency: 'factory output',
  industryPollution: 'industrial pollution',
  powerPollution: 'power-plant pollution',
  happiness: 'resident happiness',
  landValue: 'land value',
  boost: 'output of facilities like it',
};

export const COMPONENT_LABEL: Record<ComponentKind, string> = {
  glass: 'glass curtain walls',
  stone: 'dressed stone walls',
  timber: 'timber frames',
  brick: 'fired-brick walls',
  gardenRoof: 'planted roofs',
  solarRoof: 'solar roofs',
  tallFrame: 'taller structural frames',
  fins: 'shading fins',
  dome: 'domes',
};
