import type { Axes } from '../style/Movements';

/**
 * The words the Design Studio understands. Each entry maps phrases to an
 * idea, a window style, a colour or a nudge on the style axes. Phrases are
 * matched after simple stemming (plurals, -ed/-ing are listed explicitly),
 * longest first, so "raw concrete" wins over "concrete".
 */

export type Target =
  | { idea: string }
  /** A garden whose kind depends on where it goes (roof, every floor, the sky, the ground). */
  | { garden: true }
  /** Balconies: planted, deep or plain, depending on what's around them. */
  | { balcony: true }
  | { window: number; label: string }
  | { colour: [number, number, number]; label: string }
  | { lean: Partial<Axes>; label: string }
  /** Recognised but not something the architects can do: suggests ideas instead. */
  | { unsupported: string; suggest: string[] };

export const LEXICON: [string[], Target][] = [
  // Uses.
  [['flat', 'flats', 'apartment', 'apartments', 'home', 'homes', 'housing', 'residential', 'condo', 'condos', 'residence', 'dwelling', 'living', 'place to live', 'tenement', 'block of flats', 'apartment block'], { idea: 'homes' }],
  [['office', 'offices', 'workplace', 'workspace', 'headquarters', 'hq', 'business', 'corporate', 'company', 'coworking', 'work'], { idea: 'offices' }],
  [['shop', 'shops', 'store', 'stores', 'retail', 'market', 'boutique', 'mall', 'shopping', 'cafe', 'cafes', 'restaurant', 'shopfront', 'storefront', 'parade'], { idea: 'shops' }],
  [['mixed use', 'mixed-use', 'live work', 'over the shop', 'above the shops', 'above shops', 'over shops'], { idea: 'mixed' }],
  // Size.
  [['house', 'houses', 'villa', 'bungalow', 'cottage', 'cottages', 'detached', 'family home', 'single family', 'cabin', 'chalet'], { idea: 'house' }],
  [['row house', 'row houses', 'rowhouse', 'townhouse', 'townhouses', 'town house', 'terrace house', 'terraced house', 'terraced houses', 'brownstone', 'brownstones'], { idea: 'row' }],
  [['low rise', 'lowrise', 'small block', 'few storeys', 'low'], { idea: 'low' }],
  [['mid rise', 'midrise', 'medium', 'medium sized', 'mid size'], { idea: 'mid' }],
  [['tall', 'tower', 'towers', 'high rise', 'highrise', 'tall building', 'massive tower', 'big tower', 'tall block'], { idea: 'tall' }],
  [['skyscraper', 'skyscrapers', 'supertall', 'super tall', 'megatower', 'sky high', 'very tall', 'really tall', 'extremely tall'], { idea: 'sky' }],
  // Walls.
  [['render', 'rendered', 'plaster', 'plastered', 'stucco', 'painted', 'whitewashed', 'smooth walls'], { idea: 'render' }],
  [['brick', 'bricks', 'brickwork', 'red brick', 'masonry'], { idea: 'brick' }],
  [['weatherboard', 'clapboard', 'siding', 'boards', 'shiplap'], { idea: 'siding' }],
  [['timber', 'wood', 'wooden', 'log', 'logs', 'cedar', 'oak', 'pine', 'plywood', 'clt', 'bamboo'], { idea: 'timber' }],
  [['stone', 'stones', 'marble', 'granite', 'limestone', 'sandstone', 'masonry stone', 'ashlar'], { idea: 'stone' }],
  [['concrete', 'raw concrete', 'beton', 'brutalist', 'brutalism', 'brutal', 'cement', 'board marked'], { idea: 'concrete' }],
  [['glass', 'glassy', 'glazed', 'mirror', 'mirrored', 'transparent', 'curtain wall', 'see through', 'reflective'], { idea: 'glass' }],
  [['prefab', 'prefabricated', 'panel', 'panels', 'cladding', 'clad', 'modular', 'metal', 'steel', 'aluminium', 'aluminum'], { idea: 'panels' }],
  // Roofs.
  [['pitched', 'pitched roof', 'sloped roof', 'sloping roof', 'gable', 'gabled', 'a frame', 'pointy roof', 'peaked roof', 'tiled roof', 'slate roof'], { idea: 'gable' }],
  [['hipped', 'hip roof', 'hipped roof'], { idea: 'hip' }],
  [['flat roof', 'flat roofed', 'flat top', 'flat topped'], { idea: 'flat' }],
  [['mansard', 'mansard roof', 'parisian', 'french roof', 'dormer', 'dormers', 'attic windows'], { idea: 'mansard' }],
  [['green roof', 'grass roof', 'sedum', 'living roof', 'planted roof', 'turf roof', 'grassy roof'], { idea: 'greenroof' }],
  [['butterfly', 'butterfly roof', 'v shaped roof', 'inverted roof'], { idea: 'butterfly' }],
  [['sawtooth', 'saw tooth', 'shed roof', 'mono pitch', 'monopitch', 'slanted roof', 'zigzag roof'], { idea: 'sawtooth' }],
  [['vault', 'vaulted', 'barrel roof', 'curved roof', 'arched roof', 'round roof', 'dome', 'domed', 'curved'], { idea: 'vault' }],
  // Gardens and balconies (placement decides which idea).
  [['garden', 'gardens', 'tree', 'trees', 'plant', 'plants', 'planted', 'planting', 'greenery', 'foliage', 'leaves', 'flowers', 'shrubs', 'bushes', 'vines', 'ivy', 'jungle', 'forest', 'park', 'parks', 'lawn', 'grass'], { garden: true }],
  [['balcony', 'balconies', 'terrace balcony', 'deck', 'decks', 'porch', 'veranda', 'verandah'], { balcony: true }],
  [['roof garden', 'rooftop garden', 'roof terrace', 'rooftop terrace', 'rooftop park', 'roof park', 'pergola'], { idea: 'roofgarden' }],
  [['vertical forest', 'vertical garden', 'living wall', 'green wall', 'green facade', 'planted balconies', 'hanging gardens', 'hanging garden'], { idea: 'planters' }],
  [['sky garden', 'sky gardens', 'skygarden', 'garden in the sky', 'gardens in the sky', 'sky park', 'floating garden', 'floating gardens'], { idea: 'skygarden' }],
  // Form and features.
  [['terraced', 'terraces', 'terrace', 'stepped', 'steps', 'stepping back', 'set back', 'setbacks', 'tiered', 'tiers', 'ziggurat', 'wedding cake'], { idea: 'terraces' }],
  [['fins', 'louvres', 'louvers', 'sunshades', 'sun shades', 'shading', 'shades', 'brise soleil', 'brise-soleil', 'screens', 'sun fins'], { idea: 'brise' }],
  [['stilts', 'columns', 'pillars', 'pilotis', 'raised', 'lifted', 'on legs', 'elevated', 'floating above'], { idea: 'pilotis' }],
  [['arcade', 'arcades', 'colonnade', 'colonnades', 'portico', 'porticoes', 'covered walkway', 'covered street', 'cloister'], { idea: 'arcade' }],
  [['monumental', 'monument', 'heavy', 'chunky', 'imposing', 'massive', 'solid', 'thick walls', 'fortress', 'bunker', 'castle', 'bold'], { idea: 'monumental' }],
  [['solar', 'solar panels', 'solar panel', 'photovoltaic', 'pv', 'sun powered', 'solar powered'], { idea: 'solar' }],
  [['wind turbine', 'wind turbines', 'turbines', 'turbine', 'windmill', 'windmills', 'wind powered'], { idea: 'wind' }],
  [['ornate', 'ornament', 'ornamented', 'decorated', 'decorative', 'detailed', 'cornice', 'cornices', 'carved', 'classical', 'grand', 'elegant', 'baroque', 'victorian', 'georgian', 'art deco', 'deco', 'gothic', 'beaux arts', 'neoclassical', 'pediment', 'pillared'], { idea: 'ornament' }],
  [['overhang', 'overhangs', 'overhanging', 'cantilever', 'cantilevered', 'jutting', 'sticking out', 'floating floors', 'projecting'], { idea: 'cantilever' }],
  [['loggia', 'loggias', 'recessed balconies', 'deep balconies', 'sheltered balconies', 'inset balconies'], { idea: 'loggias' }],
  [['courtyard', 'courtyards', 'inner garden', 'patio', 'quad', 'quadrangle', 'atrium', 'around a garden', 'shared garden'], { idea: 'courtyard' }],
  [['stacked', 'stacking', 'jenga', 'stacked boxes', 'blocky', 'cubes', 'cubic', 'offset', 'piled', 'stacked blocks'], { idea: 'stacked' }],
  // Character.
  [['affordable', 'cheap', 'budget', 'low cost', 'social', 'council', 'public housing', 'basic', 'simple', 'economical', 'inexpensive'], { idea: 'budget' }],
  [['cosy', 'cozy', 'quaint', 'charming', 'homely', 'friendly', 'small', 'tiny', 'village', 'intimate'], { idea: 'cosy' }],
  [['modern', 'contemporary', 'futuristic', 'sleek', 'minimal', 'minimalist', 'clean', 'high tech', 'hi tech', 'cutting edge', 'innovative', 'sci fi'], { idea: 'modern' }],
  [['traditional', 'classic', 'old fashioned', 'old', 'historic', 'historical', 'heritage', 'vintage', 'rustic', 'old world', 'timeless'], { idea: 'traditional' }],
  [['eco', 'green', 'sustainable', 'natural', 'leafy', 'organic', 'environmental', 'eco friendly', 'nature', 'biophilic', 'solarpunk'], { idea: 'eco' }],
  [['luxury', 'luxurious', 'fancy', 'upmarket', 'upscale', 'posh', 'expensive', 'premium', 'exclusive', 'high end', 'deluxe', 'penthouse', 'rich'], { idea: 'luxury' }],
  // Windows.
  [['big windows', 'large windows', 'huge windows', 'floor to ceiling', 'full height windows', 'picture windows', 'lots of glass', 'all glass'], { window: 6, label: 'Full-height windows' }],
  [['arched windows', 'arches', 'arched', 'round windows'], { window: 5, label: 'Arched windows' }],
  [['small windows', 'slit windows', 'narrow windows', 'tiny windows', 'slot windows'], { window: 7, label: 'Slot windows' }],
  [['deep windows', 'square windows', 'punched windows'], { window: 4, label: 'Deep square windows' }],
  [['french windows', 'french doors', 'tall windows'], { window: 2, label: 'French windows' }],
  [['ribbon windows', 'strip windows', 'horizontal windows', 'wide windows', 'long windows'], { window: 3, label: 'Ribbon windows' }],
  // Colours (hue 0–1, saturation, lightness).
  [['white', 'white walls', 'bright white'], { colour: [0.1, 0.06, 0.9], label: 'White' }],
  [['cream', 'ivory', 'beige', 'sand', 'sandy'], { colour: [0.11, 0.3, 0.8], label: 'Cream' }],
  [['grey', 'gray', 'silver', 'concrete grey'], { colour: [0.6, 0.03, 0.6], label: 'Grey' }],
  [['black', 'dark', 'charcoal', 'black walls'], { colour: [0.6, 0.04, 0.2], label: 'Dark' }],
  [['red', 'crimson', 'terracotta'], { colour: [0.01, 0.5, 0.42], label: 'Red' }],
  [['orange', 'ochre', 'amber'], { colour: [0.07, 0.55, 0.55], label: 'Ochre' }],
  [['yellow', 'mustard', 'golden'], { colour: [0.13, 0.55, 0.62], label: 'Yellow' }],
  [['blue', 'navy', 'sky blue', 'azure'], { colour: [0.58, 0.35, 0.55], label: 'Blue' }],
  [['pink', 'rose', 'salmon', 'coral'], { colour: [0.98, 0.45, 0.72], label: 'Pink' }],
  [['purple', 'violet', 'lilac', 'lavender'], { colour: [0.78, 0.25, 0.62], label: 'Lilac' }],
  [['brown', 'chocolate', 'bronze', 'copper'], { colour: [0.07, 0.4, 0.33], label: 'Brown' }],
  [['teal', 'turquoise', 'mint', 'sage', 'olive'], { colour: [0.42, 0.25, 0.55], label: 'Sage' }],
  [['colourful', 'colorful', 'bright', 'vibrant', 'pastel', 'rainbow', 'playful', 'fun'], { lean: { ornate: 0.3 }, label: 'Colourful' }],
  // Recognised, but not something your architects do.
  [['pool', 'swimming pool', 'pools', 'spa', 'hot tub'], { unsupported: 'Pools aren’t something your architects can design yet.', suggest: ['roofgarden'] }],
  [['pyramid', 'pyramids'], { unsupported: 'No pyramids, but stepped terraces come close.', suggest: ['terraces'] }],
  [['spire', 'spires', 'steeple', 'antenna', 'mast'], { unsupported: 'Spires come with ornamented towers.', suggest: ['ornament', 'tall'] }],
  [['treehouse', 'tree house'], { unsupported: 'A treehouse is timber with a vertical forest.', suggest: ['timber', 'planters'] }],
  [['skybridge', 'sky bridge', 'bridge', 'bridges'], { unsupported: 'Bridges between buildings aren’t possible yet; overhangs are the nearest thing.', suggest: ['cantilever'] }],
  [['curvy', 'round', 'circular', 'cylinder', 'cylindrical', 'organic shape', 'blob', 'wavy'], { unsupported: 'Your architects build straight walls; a vaulted roof is the nearest curve.', suggest: ['vault'] }],
  [['underground', 'basement', 'bunker underground'], { unsupported: 'Everything is built above ground.', suggest: [] }],
];

/** Words that carry no design meaning by themselves. */
export const STOPWORDS = new Set(
  ('a an the and or but with without of in on at to for from by as into onto over under near next some any lots lot plenty full loads tons ' +
    'that which who this these those it its is are be been being was were has have having had i me my we our us you your they their ' +
    'want wants would like love please make build made create design need needs should could can will just also plus too then than ' +
    'kind sort type style building buildings thing things place one ones something lots maybe mostly mainly mostly bit ' +
    'up down out top bottom side sides front back middle inside outside around between above below all every each way ' +
    'floor floors storey storeys story stories level levels ground street roof roofs rooftop sky base half ' +
    'really very super extremely so quite rather somewhat slightly little touch hint not no never dont don t free avoid except ' +
    'lots everywhere covered there here where when how what why so yes ok okay good nice great pretty cool awesome beautiful lovely ' +
    'look looks looking feel feels feeling ish style styled inspired themed theme vibe vibes area city town block blocks structure structures building tall_ building complex').split(' '),
);

/** Number words for storey counts ("a ten-storey tower"). */
export const NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
};

export const NEGATIONS = new Set(['no', 'not', 'without', 'never', 'dont', 'avoid', 'except', 'nothing', 'non', 'free']);
export const STRONG = new Set(['very', 'really', 'super', 'extremely', 'so', 'loads', 'tons', 'plenty', 'full', 'covered', 'lots', 'totally', 'incredibly', 'insanely', 'massively']);
export const WEAK = new Set(['bit', 'slightly', 'little', 'somewhat', 'touch', 'hint', 'kinda', 'kind', 'sort', 'sorta', 'bits', 'subtle', 'subtly']);

/** Where a garden or shops go. */
export type Placement = 'roof' | 'all' | 'sky' | 'base' | 'inside';
export const PLACEMENTS: [string[], Placement][] = [
  [['on the roof', 'on top', 'rooftop', 'on the rooftop', 'up top', 'on the roofs', 'roof top', 'roof'], 'roof'],
  [['every floor', 'each floor', 'all floors', 'every level', 'each level', 'every storey', 'all the way up', 'every balcony', 'all over', 'covered in', 'on every floor', 'up the sides', 'on the facade', 'on the walls'], 'all'],
  [['in the sky', 'halfway up', 'half way up', 'in the middle of the tower', 'mid air', 'midair', 'up high', 'between floors', 'part way up'], 'sky'],
  [['at the bottom', 'on the ground floor', 'ground floor', 'street level', 'at street level', 'downstairs', 'underneath', 'at the base', 'below', 'on the street'], 'base'],
  [['in the middle', 'inside', 'in the centre', 'in the center', 'at the heart', 'enclosed'], 'inside'],
];
