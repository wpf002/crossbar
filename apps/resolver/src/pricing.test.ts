import { describe, it, expect } from 'vitest';
import { computeOutcome, computePlayerOutcome, computePeriodOutcome } from './pricing.js';

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

  describe('PLAYER_TOTAL (computePlayerOutcome)', () => {
    it('stat > line → YES (over)', () => {
      expect(computePlayerOutcome(45.5, 84)).toBe('YES');
    });

    it('stat < line → NO (under)', () => {
      expect(computePlayerOutcome(45.5, 31)).toBe('NO');
    });

    it('stat === line → INVALID (push)', () => {
      expect(computePlayerOutcome(2, 2)).toBe('INVALID');
    });

    it('zero stat under a 0.5 line → NO', () => {
      expect(computePlayerOutcome(0.5, 0)).toBe('NO');
    });

    it('null line → INVALID', () => {
      expect(computePlayerOutcome(null, 10)).toBe('INVALID');
    });

    it('missing stat → INVALID', () => {
      expect(computePlayerOutcome(45.5, null)).toBe('INVALID');
      expect(computePlayerOutcome(45.5, undefined)).toBe('INVALID');
    });

    it('NaN stat → INVALID', () => {
      expect(computePlayerOutcome(45.5, Number.NaN)).toBe('INVALID');
    });
  });

  describe('PERIOD_WINNER (computePeriodOutcome)', () => {
    const home = [7, 3, 10, 0];
    const away = [0, 3, 7, 14];

    it('home outscores away in the period → YES', () => {
      expect(computePeriodOutcome(home, away, 1)).toBe('YES'); // 7 vs 0
      expect(computePeriodOutcome(home, away, 3)).toBe('YES'); // 10 vs 7
    });

    it('away outscores home → NO', () => {
      expect(computePeriodOutcome(home, away, 4)).toBe('NO'); // 0 vs 14
    });

    it('tied period → INVALID (push)', () => {
      expect(computePeriodOutcome(home, away, 2)).toBe('INVALID'); // 3 vs 3
    });

    it('period not yet played / missing → INVALID', () => {
      expect(computePeriodOutcome(home, away, 5)).toBe('INVALID');
      expect(computePeriodOutcome([], [], 1)).toBe('INVALID');
    });

    it('period < 1 → INVALID', () => {
      expect(computePeriodOutcome(home, away, 0)).toBe('INVALID');
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
