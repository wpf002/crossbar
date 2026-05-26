import { describe, it, expect } from 'vitest';
import { computeOutcome } from './pricing.js';

function mkMarket(type: 'MONEYLINE' | 'TOTAL' | 'SPREAD', line: number | null = null) {
  return { type, line };
}

describe('pricing.computeOutcome', () => {
  describe('MONEYLINE', () => {
    it('home > away → YES', () => {
      expect(
        computeOutcome(mkMarket('MONEYLINE'), { homeScore: 5, awayScore: 3 }),
      ).toBe('YES');
    });

    it('home < away → NO', () => {
      expect(
        computeOutcome(mkMarket('MONEYLINE'), { homeScore: 2, awayScore: 7 }),
      ).toBe('NO');
    });

    it('tie → INVALID', () => {
      expect(
        computeOutcome(mkMarket('MONEYLINE'), { homeScore: 4, awayScore: 4 }),
      ).toBe('INVALID');
    });
  });

  describe('TOTAL', () => {
    it('combined > line → YES', () => {
      expect(
        computeOutcome(mkMarket('TOTAL', 8.5), { homeScore: 5, awayScore: 4 }),
      ).toBe('YES');
    });

    it('combined < line → NO', () => {
      expect(
        computeOutcome(mkMarket('TOTAL', 9.5), { homeScore: 5, awayScore: 4 }),
      ).toBe('NO');
    });

    it('combined === line → INVALID (push)', () => {
      expect(
        computeOutcome(mkMarket('TOTAL', 9), { homeScore: 5, awayScore: 4 }),
      ).toBe('INVALID');
    });

    it('null line → INVALID', () => {
      expect(
        computeOutcome(mkMarket('TOTAL', null), { homeScore: 5, awayScore: 4 }),
      ).toBe('INVALID');
    });
  });

  describe('SPREAD', () => {
    it('diff > line → YES (home covers)', () => {
      // line = -3.5, home wins by 4: 4 > -3.5 → YES
      expect(
        computeOutcome(mkMarket('SPREAD', -3.5), { homeScore: 24, awayScore: 20 }),
      ).toBe('YES');
    });

    it('diff < line → NO', () => {
      // line = -3.5, home wins by 2: 2 < -3.5 is false! → actually 2 > -3.5 → YES.
      // Try the other side: line = 3.5, away wins by 4: -4 < 3.5 → NO.
      expect(
        computeOutcome(mkMarket('SPREAD', 3.5), { homeScore: 20, awayScore: 24 }),
      ).toBe('NO');
    });

    it('diff === line → INVALID (push)', () => {
      expect(
        computeOutcome(mkMarket('SPREAD', 3), { homeScore: 27, awayScore: 24 }),
      ).toBe('INVALID');
    });

    it('null line → INVALID', () => {
      expect(
        computeOutcome(mkMarket('SPREAD', null), { homeScore: 5, awayScore: 4 }),
      ).toBe('INVALID');
    });
  });

  describe('null scores (defensive)', () => {
    it('null home score → INVALID', () => {
      expect(
        computeOutcome(mkMarket('MONEYLINE'), { homeScore: null, awayScore: 4 }),
      ).toBe('INVALID');
    });

    it('null away score → INVALID', () => {
      expect(
        computeOutcome(mkMarket('MONEYLINE'), { homeScore: 4, awayScore: null }),
      ).toBe('INVALID');
    });
  });
});
