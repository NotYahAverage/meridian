import { describe, expect, it } from 'vitest';
import { Clock } from '../src/sim/Clock';
import { NewsDesk } from '../src/sim/news/News';
import { deserializeCity, serializeCity } from '../src/sim/save/Serializer';
import { makeCity } from './helpers';

describe('newspaper', () => {
  it('always prints four stories, with seasonal features in a quiet month', () => {
    const city = makeCity({ empty: true });
    const seen: number[] = [];
    city.events.on('news', (e) => seen.push(e.issue));
    city.clock.tick = 24 * 30 * 4; // the paper reports on the month just ended
    const ed = city.news.publish();
    expect(ed.stories).toHaveLength(4);
    expect(ed.issue).toBe(1);
    expect(ed.month).toBe(3);
    expect(Clock.monthLabel(ed.month)).toBe('June, Year 1');
    expect(ed.paper).toBe(`The ${city.name} Gazette`);
    expect(new Set(ed.stories.map((s) => s.title)).size).toBe(4);
    expect(seen).toEqual([1]);
    for (const s of ed.stories) expect(s.body.length).toBeGreaterThan(10);
  });

  it('leads with the biggest news and reports month-on-month changes', () => {
    const city = makeCity({ empty: true });
    city.stats.population = 1_000;
    city.stats.workers = 500;
    city.stats.employed = 480;
    city.stats.happiness = 70;
    city.news.publish();
    // A month later: growth, a tax rise and a fire.
    city.stats.population = 1_400;
    city.stats.workers = 700;
    city.stats.employed = 680;
    city.economy.taxes.residential = 12;
    city.news.fireLost('Elm Street', 100, 200);
    city.events.emit('milestone', { index: 2, title: 'Small Town', reward: 0, unlocks: [] });
    const ed = city.news.publish();
    const titles = ed.stories.map((s) => s.title);
    expect(titles[0]).toBe(`${city.name} officially a small town`);
    expect(titles).toContain('Council raises residential tax to 12%');
    expect(titles).toContain('Fire destroys building on Elm Street');
    expect(titles.some((t) => t.includes('booming') || t.includes('newcomers') || t.includes('Moving vans'))).toBe(true);
    expect(ed.stories.find((s) => s.title.startsWith('Fire'))).toMatchObject({ tone: 'bad', x: 100, z: 200 });
    // Facts are cleared once printed.
    const next = city.news.publish();
    expect(next.stories.map((s) => s.title)).not.toContain('Fire destroys building on Elm Street');
  });

  it('reports a shrinking city and repeats tired topics less', () => {
    const city = makeCity({ empty: true });
    city.stats.population = 3_000;
    city.stats.workers = 1_500;
    city.stats.employed = 1_100;
    city.news.publish();
    city.stats.population = 2_600;
    const ed = city.news.publish();
    expect(ed.stories[0].title).toBe(`Residents are leaving ${city.name}`);
    expect(ed.stories[0].body).toContain('as jobs grow scarce');
    expect(ed.paper).toBe(`The ${city.name} Courier`);
    expect(ed.topics).toContain('jobs');
  });

  it('keeps a year of back issues across save and load', () => {
    const city = makeCity({ empty: true });
    for (let k = 0; k < 14; k++) {
      city.clock.tick += 24 * 30;
      city.news.publish();
    }
    expect(city.news.editions).toHaveLength(12);
    expect(city.news.editions[0].issue).toBe(14);
    const loaded = deserializeCity(JSON.parse(JSON.stringify(serializeCity(city))), { flatTerrain: 10 });
    expect(loaded.news.editions).toEqual(city.news.editions);
    expect(loaded.news.issue).toBe(14);
    expect(loaded.news.publish().issue).toBe(15);
    expect(NewsDesk.paperName(loaded)).toMatch(/^The .+ Gazette$/);
  });
});
