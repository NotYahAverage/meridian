import type { Axes, FeatureId, Massing, RoofKind, WallKind } from '../style/Movements';

/**
 * Ideas: the pieces your architects can design with. A few are known from the
 * start; the rest are learned from what happens in the city: grow an
 * industrial district and they learn raw concrete, keep a forest standing and
 * they learn timber, weather smog over the homes and they learn to plant the
 * facades. Every city's history gives it a different toolbox.
 */

export type IdeaCategory = 'use' | 'height' | 'material' | 'roof' | 'feature' | 'character';
export type Use = 'homes' | 'offices' | 'shops' | 'mixed';
export type Height = 'house' | 'row' | 'low' | 'mid' | 'tall' | 'sky';

/** What the idea checks in the city (computed once a day). */
export interface CityFacts {
  day: number;
  population: number;
  preset: string;
  industrial: number;
  offices: number;
  commercial: number;
  townhouses: number;
  /** Residential buildings of five floors or more. */
  dense: number;
  /** Buildings of twelve floors or more. */
  towers: number;
  parks: number;
  bigPark: boolean;
  landmarks: number;
  culture: boolean;
  solar: boolean;
  wind: boolean;
  station: boolean;
  bridge: boolean;
  /** Homes within 90 m of open water. */
  shoreHomes: number;
  /** Height range of the city's homes (m). */
  relief: number;
  /** Trees standing on the land. */
  forest: number;
  /** Average pollution at homes 0–1. */
  smog: number;
  powerShort: boolean;
  storm: boolean;
  /** Homes on land worth 70 % or more. */
  richHomes: number;
  /** Prototypes built so far. */
  prototypes: number;
}

export interface Unlock {
  test: (f: CityFacts) => boolean;
  /** How to get it, for a locked card. */
  hint: string;
  /** What happened, for the notice when it's learned. */
  story: string;
}

export interface IdeaDef {
  id: string;
  name: string;
  category: IdeaCategory;
  blurb: string;
  icon: string;
  /** Nudges the design's character on the axes. */
  lean?: Partial<Axes>;
  wall?: WallKind;
  roof?: RoofKind;
  feature?: FeatureId;
  massing?: Massing;
  use?: Use;
  height?: Height;
  /** Known from the start (otherwise it needs `unlock`). */
  start?: boolean;
  unlock?: Unlock;
}

export const IDEAS: IdeaDef[] = [
  // What it's for.
  { id: 'homes', name: 'Homes', category: 'use', icon: 'people', use: 'homes', start: true, blurb: 'Places to live.' },
  { id: 'offices', name: 'Offices', category: 'use', icon: 'office', use: 'offices', start: true, blurb: 'Places to work.' },
  { id: 'shops', name: 'Shops', category: 'use', icon: 'shop', use: 'shops', start: true, blurb: 'Places to buy things.' },
  { id: 'mixed', name: 'Homes over shops', category: 'use', icon: 'shop', use: 'mixed', start: true, blurb: 'Shops on the street, homes above.' },
  // How big.
  { id: 'house', name: 'Detached house', category: 'height', icon: 'people', height: 'house', start: true, blurb: 'A house on its own plot.', lean: { dense: -0.4 } },
  { id: 'row', name: 'Row houses', category: 'height', icon: 'people', height: 'row', start: true, blurb: 'A terrace of narrow houses.', lean: { dense: -0.1, hand: 0.1 } },
  { id: 'low', name: 'Low-rise', category: 'height', icon: 'office', height: 'low', start: true, blurb: 'Three or four storeys.', lean: { dense: 0.1 } },
  { id: 'mid', name: 'Mid-rise', category: 'height', icon: 'office', height: 'mid', start: true, blurb: 'Five to nine storeys.', lean: { dense: 0.3 } },
  {
    id: 'tall', name: 'Tower', category: 'height', icon: 'obstower', height: 'tall', blurb: 'Ten to twenty storeys.', lean: { dense: 0.6 },
    unlock: { test: (f) => f.population >= 2_000, hint: 'Grow to 2,000 residents', story: 'With 2,000 residents, your architects can think about building up.' },
  },
  {
    id: 'sky', name: 'Skyscraper', category: 'height', icon: 'obstower', height: 'sky', blurb: 'Over twenty storeys.', lean: { dense: 0.9, heavy: -0.1 },
    unlock: { test: (f) => f.population >= 8_000 && f.towers >= 2, hint: 'Grow to 8,000 residents with two towers', story: 'A skyline is forming: your architects are ready to go higher still.' },
  },
  // What it's made of.
  { id: 'render', name: 'Painted render', category: 'material', icon: 'brush', wall: 'render', start: true, blurb: 'Smooth plaster in soft colours.', lean: { ornate: 0.1 } },
  { id: 'brick', name: 'Brick', category: 'material', icon: 'build', wall: 'brick', start: true, blurb: 'Fired clay, laid by hand.', lean: { hand: 0.5, heavy: 0.2 } },
  { id: 'siding', name: 'Weatherboard', category: 'material', icon: 'build', wall: 'siding', start: true, blurb: 'Painted timber boards.', lean: { hand: 0.4, dense: -0.3 } },
  {
    id: 'timber', name: 'Timber', category: 'material', icon: 'tree', wall: 'timber', blurb: 'Warm wood cladding and frames.', lean: { hand: 0.5, green: 0.5, heavy: -0.3 },
    unlock: { test: (f) => f.forest >= 3_000, hint: 'Keep a large forest standing near your city', story: 'Your architects studied the forests around the city and learned to build in timber.' },
  },
  {
    id: 'stone', name: 'Stone', category: 'material', icon: 'landmark', wall: 'stone', blurb: 'Dressed stone, built to last.', lean: { heavy: 0.5, ornate: 0.4, hand: 0.3 },
    unlock: { test: (f) => f.landmarks >= 1 || (f.preset === 'highlands' && f.population >= 500), hint: 'Build a landmark, or grow a highland town', story: 'Masons who worked on your landmark now offer their stone for everyday buildings.' },
  },
  {
    id: 'concrete', name: 'Raw concrete', category: 'material', icon: 'factory', wall: 'beton', blurb: 'Board-marked concrete, bold and cheap.', lean: { heavy: 0.8, hand: -0.4, ornate: -0.3 },
    unlock: { test: (f) => f.industrial >= 12, hint: 'Grow an industrial district (12 buildings)', story: 'Your industrial district taught your architects to work in raw concrete.' },
  },
  {
    id: 'glass', name: 'Glass', category: 'material', icon: 'office', wall: 'glass', blurb: 'Curtain walls of glass and thin frames.', lean: { heavy: -0.8, hand: -0.6, dense: 0.2 },
    unlock: { test: (f) => f.offices >= 8, hint: 'Grow an office district (8 buildings)', story: 'Office developers brought curtain-wall glass to your city.' },
  },
  {
    id: 'panels', name: 'Prefab panels', category: 'material', icon: 'grid', wall: 'panel', blurb: 'Factory-made panels, quick to put up.', lean: { hand: -0.7, ornate: -0.2 },
    unlock: { test: (f) => f.population >= 4_000, hint: 'Grow to 4,000 residents', story: 'To keep up with all the new residents, your builders turned to factory-made panels.' },
  },
  // Roofs.
  { id: 'gable', name: 'Pitched roof', category: 'roof', icon: 'home', roof: 'gable', start: true, blurb: 'Two slopes meeting at a ridge.', lean: { hand: 0.3 } },
  { id: 'hip', name: 'Hipped roof', category: 'roof', icon: 'home', roof: 'hip', start: true, blurb: 'Slopes on all four sides.', lean: { hand: 0.2, ornate: 0.1 } },
  { id: 'flat', name: 'Flat roof', category: 'roof', icon: 'grid', roof: 'flat', start: true, blurb: 'A flat roof behind a parapet.', lean: { hand: -0.2, dense: 0.1 } },
  {
    id: 'mansard', name: 'Mansard roof', category: 'roof', icon: 'home', roof: 'mansard', blurb: 'A steep roof with dormer windows.', lean: { ornate: 0.6, dense: 0.2 },
    unlock: { test: (f) => f.day >= 360, hint: 'Let your city grow a year old', story: 'A year on, your city has an old town, and your architects have learned its grand mansard roofs.' },
  },
  {
    id: 'greenroof', name: 'Green roof', category: 'roof', icon: 'tree', roof: 'green', feature: 'greenRoof', blurb: 'A planted roof of sedum and grasses.', lean: { green: 0.7 },
    unlock: { test: (f) => f.parks >= 3, hint: 'Build three parks', story: 'Your parks inspired your architects to plant the roofs themselves.' },
  },
  {
    id: 'butterfly', name: 'Butterfly roof', category: 'roof', icon: 'rain', roof: 'butterfly', blurb: 'Two slopes falling to a valley that catches the rain.', lean: { hand: -0.5, heavy: -0.4 },
    unlock: { test: (f) => f.storm, hint: 'Weather a thunderstorm', story: 'After the storm, your architects designed roofs that gather rainwater.' },
  },
  {
    id: 'sawtooth', name: 'Sawtooth roof', category: 'roof', icon: 'factory', roof: 'shed', blurb: 'Single slopes like an old mill.', lean: { hand: -0.3, heavy: 0.1 },
    unlock: { test: (f) => f.industrial >= 5, hint: 'Build five industrial buildings', story: 'The mills and workshops gave your architects a taste for sawtooth roofs.' },
  },
  {
    id: 'vault', name: 'Vaulted roof', category: 'roof', icon: 'metro', roof: 'vault', blurb: 'A curved barrel vault.', lean: { heavy: 0.3, ornate: 0.2 },
    unlock: { test: (f) => f.station, hint: 'Build a transit station', story: 'The great vault of your station is being copied all over town.' },
  },
  // Features.
  {
    id: 'balconies', name: 'Balconies', category: 'feature', icon: 'home', feature: 'balconies', start: true, blurb: 'Somewhere to sit outside.', lean: {},
  },
  {
    id: 'roofgarden', name: 'Roof garden', category: 'feature', icon: 'parks', feature: 'roofGarden', blurb: 'Trees and a pergola up on the roof.', lean: { green: 0.6, dense: 0.2 },
    unlock: { test: (f) => f.parks >= 5 || f.bigPark, hint: 'Build five parks, or a large park', story: 'Residents asked for gardens closer to home: your architects took them up onto the roofs.' },
  },
  {
    id: 'planters', name: 'Vertical forest', category: 'feature', icon: 'tree', feature: 'planters', blurb: 'Balconies spilling with trees and plants.', lean: { green: 0.9, dense: 0.3 },
    unlock: { test: (f) => f.smog >= 0.18, hint: 'Live through smog over your homes', story: 'Choking on smog, residents began planting their balconies. Your architects made it part of the design.' },
  },
  {
    id: 'skygarden', name: 'Sky gardens', category: 'feature', icon: 'parks', feature: 'skyGarden', blurb: 'Open planted floors part-way up a tower.', lean: { green: 0.8, dense: 0.6 },
    unlock: { test: (f) => f.towers >= 1 && f.bigPark, hint: 'Build a tower and a large park', story: 'Why should a park stay on the ground? Your architects have opened gardens in the sky.' },
  },
  {
    id: 'terraces', name: 'Stepped terraces', category: 'feature', icon: 'terrain', feature: 'terraces', massing: 'terraced', blurb: 'Floors step back into planted terraces.', lean: { green: 0.6, heavy: 0.2 },
    unlock: { test: (f) => f.relief >= 14, hint: 'Build homes on a hillside', story: 'Building on the hills taught your architects to step their buildings back in terraces.' },
  },
  {
    id: 'brise', name: 'Sun fins', category: 'feature', icon: 'sun', feature: 'briseSoleil', blurb: 'A deep grid of fins shading the windows (brise-soleil).', lean: { heavy: 0.7, hand: -0.3 },
    unlock: { test: (f) => f.powerShort, hint: 'Run short of power', story: 'To save power on cooling, your architects shaded the windows with deep fins.' },
  },
  {
    id: 'pilotis', name: 'On stilts', category: 'feature', icon: 'anchor', feature: 'pilotis', massing: 'slab', blurb: 'The building lifted on columns, the ground left open (pilotis).', lean: { hand: -0.6, dense: 0.3 },
    unlock: { test: (f) => f.shoreHomes >= 12, hint: 'Build homes by the water', story: 'Living by the water, your architects learned to lift buildings up on columns.' },
  },
  {
    id: 'arcade', name: 'Arcade', category: 'feature', icon: 'shop', feature: 'arcade', blurb: 'A colonnade sheltering the shops.', lean: { ornate: 0.5, dense: 0.4 },
    unlock: { test: (f) => f.commercial >= 15, hint: 'Grow a shopping street (15 shops)', story: 'Your busy shopping streets have grown covered arcades.' },
  },
  {
    id: 'monumental', name: 'Monumental', category: 'feature', icon: 'landmark', feature: 'monumental', blurb: 'Thick walls, stacked volumes, heavy parapets.', lean: { heavy: 0.9, dense: 0.3 },
    unlock: { test: (f) => f.landmarks >= 2, hint: 'Build two landmarks', story: 'Your landmarks have given the city a taste for buildings with weight.' },
  },
  {
    id: 'solar', name: 'Solar skin', category: 'feature', icon: 'sun', feature: 'solarSkin', blurb: 'Facades and roofs clad in solar panels.', lean: { hand: -0.7, green: 0.5 },
    unlock: { test: (f) => f.solar, hint: 'Build a solar farm', story: 'Your solar farm showed what panels can do: now they can clad your buildings.' },
  },
  {
    id: 'wind', name: 'Rooftop turbines', category: 'feature', icon: 'power', feature: 'windCrown', blurb: 'Small wind turbines spinning on the roof.', lean: { hand: -0.6, green: 0.5 },
    unlock: { test: (f) => f.wind, hint: 'Build a wind turbine', story: 'Inspired by your wind farm, your architects have put small turbines on the roofs.' },
  },
  {
    id: 'ornament', name: 'Ornament', category: 'feature', icon: 'museum', feature: 'ornament', blurb: 'Cornices, quoins, string courses and pediments.', lean: { ornate: 0.9, hand: 0.3 },
    unlock: { test: (f) => f.culture || f.population >= 6_000, hint: 'Build a museum or cathedral, or grow to 6,000', story: 'Your city’s culture has rubbed off: your architects have rediscovered ornament.' },
  },
  {
    id: 'cantilever', name: 'Overhangs', category: 'feature', icon: 'upgrade', feature: 'cantilever', blurb: 'Upper floors reaching out over the street.', lean: { heavy: -0.4, hand: -0.4 },
    unlock: { test: (f) => f.bridge, hint: 'Build a bridge', story: 'Your engineers built a bridge; your architects borrowed the trick and made floors that reach out over the street.' },
  },
  {
    id: 'loggias', name: 'Loggias', category: 'feature', icon: 'home', feature: 'loggias', blurb: 'Deep, sheltered balconies framed in solid walls.', lean: { heavy: 0.5 },
    unlock: { test: (f) => f.dense >= 8, hint: 'Build eight mid-rise blocks of homes', story: 'Living close together, residents wanted private outdoor space: deep loggias.' },
  },
  {
    id: 'courtyard', name: 'Courtyard', category: 'feature', icon: 'parks', feature: 'courtyard', massing: 'courtyard', blurb: 'A block wrapped around a shared garden.', lean: { hand: 0.3, green: 0.4, dense: -0.1 },
    unlock: { test: (f) => f.townhouses >= 12, hint: 'Build twelve rows of houses', story: 'Your row-house streets taught your architects the shared back garden: the courtyard.' },
  },
  {
    id: 'stacked', name: 'Stacked boxes', category: 'feature', icon: 'grid', massing: 'stacked', blurb: 'Volumes piled with offsets, every one different.', lean: { heavy: 0.4, dense: 0.4, hand: -0.3 },
    unlock: { test: (f) => f.prototypes >= 1, hint: 'Build your first prototype', story: 'Your first prototype made your architects bolder: now they stack volumes like building blocks.' },
  },
  // Character.
  { id: 'budget', name: 'Affordable', category: 'character', icon: 'money', start: true, blurb: 'Plain, dense and cheap to build.', lean: { ornate: -0.4, dense: 0.3, hand: -0.2 } },
  { id: 'cosy', name: 'Cosy', category: 'character', icon: 'happy', start: true, blurb: 'Small-scale, warm and friendly.', lean: { dense: -0.4, hand: 0.3, ornate: 0.1 } },
  { id: 'modern', name: 'Modern', category: 'character', icon: 'office', start: true, blurb: 'Clean lines, no decoration.', lean: { hand: -0.4, ornate: -0.4 } },
  { id: 'traditional', name: 'Traditional', category: 'character', icon: 'home', start: true, blurb: 'The way buildings used to be made.', lean: { hand: 0.4, ornate: 0.3 } },
  { id: 'eco', name: 'Eco', category: 'character', icon: 'tree', start: true, blurb: 'Green, natural and low-impact.', lean: { green: 0.6 } },
  {
    id: 'luxury', name: 'Luxury', category: 'character', icon: 'money', blurb: 'Generous, refined and expensive.', lean: { ornate: 0.5, dense: -0.2 },
    unlock: { test: (f) => f.richHomes >= 10, hint: 'Grow a wealthy neighbourhood', story: 'Your wealthy neighbourhoods are asking for something special.' },
  },
];

export const IDEA_BY_ID = new Map(IDEAS.map((i) => [i.id, i]));

export const CATEGORY_LABEL: Record<IdeaCategory, string> = {
  use: 'What it’s for',
  height: 'How big',
  material: 'Walls',
  roof: 'Roof',
  feature: 'Features',
  character: 'Character',
};
