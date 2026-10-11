import { describe, expect, it } from 'vitest';
import { formatInt, formatMoney, formatPct } from '../src/core/math';

describe('number formatting', () => {
  it('groups thousands like en-US', () => {
    for (const n of [0, 7, 999, 1000, 12345, 123456, 1234567, -1234567, -999, -1000, 1e9]) expect(formatInt(n)).toBe(n.toLocaleString('en-US'));
    expect(formatInt(1234.6)).toBe('1,235');
  });

  it('formats money with a dollar sign', () => {
    expect(formatMoney(0)).toBe('$0');
    expect(formatMoney(4899)).toBe('$4,899');
    expect(formatMoney(-4899.4)).toBe('-$4,899');
    expect(formatMoney(12_500, true)).toBe('$12.5k');
    expect(formatMoney(-2_500_000, true)).toBe('-$2.50M');
  });

  it('formats percentages', () => {
    expect(formatPct(0.163)).toBe('16%');
    expect(formatPct(0.1634, 1)).toBe('16.3%');
  });
});
