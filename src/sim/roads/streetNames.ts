import { Rng } from '../../core/rng';
import type { RoadTypeId } from './RoadTypes';

const ROOTS = [
  'Maple', 'Cedar', 'Birch', 'Willow', 'Harbor', 'Ridge', 'Linden', 'Juniper', 'Aspen', 'Sycamore',
  'Magnolia', 'Laurel', 'Hawthorn', 'Chestnut', 'Alder', 'Rowan', 'Prospect', 'Union', 'Franklin',
  'Beacon', 'Orchard', 'Meadow', 'Summit', 'Riverside', 'Lakeview', 'Bayview', 'Highland', 'Parkside',
  'Kingsley', 'Ashford', 'Brookside', 'Fairview', 'Westbrook', 'Clearwater', 'Granite', 'Copper',
  'Marigold', 'Sterling', 'Holloway', 'Whitmore', 'Calloway', 'Dunmore', 'Everly', 'Fenwick',
  'Galloway', 'Hartwell', 'Ingram', 'Jasper', 'Kensington', 'Lancaster', 'Montague', 'Northgate',
  'Oakridge', 'Pemberton', 'Quarry', 'Redwood', 'Sutton', 'Thornbury', 'Upton', 'Waverly', 'Yarrow',
  'Cypress', 'Hollis', 'Mercer', 'Lindell', 'Harrow', 'Bramble', 'Larkspur', 'Foxglove', 'Heron',
  'Osprey', 'Kestrel', 'Sparrow', 'Wren', 'Sable', 'Amber', 'Saffron', 'Indigo', 'Crescent', 'Meridian',
  'Pioneer', 'Liberty', 'Station', 'Market', 'Mill', 'Foundry', 'Canal', 'Dockside', 'Signal', 'Lantern',
];

const STREET_SUFFIX = ['Street', 'Lane', 'Road', 'Drive', 'Way', 'Court', 'Place', 'Terrace', 'Row', 'Close'];

export class StreetNamer {
  private rng: Rng;
  private used = new Set<string>();

  constructor(seed: number) {
    this.rng = new Rng(seed ^ 0x51ee7);
  }

  get state(): number {
    return this.rng.state;
  }

  set state(v: number) {
    this.rng.state = v;
  }

  next(type: RoadTypeId): string {
    for (let attempt = 0; attempt < 40; attempt++) {
      const root = this.rng.pick(ROOTS);
      let name: string;
      switch (type) {
        case 'avenue':
          name = `${root} Avenue`;
          break;
        case 'boulevard':
          name = `${root} Boulevard`;
          break;
        case 'highway':
          name = `Route ${this.rng.int(2, 99)}`;
          break;
        case 'expressway':
          name = `Interstate ${this.rng.int(10, 99)}`;
          break;
        case 'lane':
          name = `${root} Lane`;
          break;
        case 'parkway':
          name = `${root} Parkway`;
          break;
        default:
          name = `${root} ${this.rng.pick(STREET_SUFFIX)}`;
      }
      if (!this.used.has(name) || attempt === 39) {
        this.used.add(name);
        return name;
      }
    }
    return 'Unnamed Road';
  }

  markUsed(name: string): void {
    this.used.add(name);
  }
}
