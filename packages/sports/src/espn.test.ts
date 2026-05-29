import { describe, it, expect } from 'vitest';
import { parseBoxscorePlayers, parseSummary } from './espn.js';

describe('parseBoxscorePlayers', () => {
  it('merges a player across multiple stat categories', () => {
    const teams = [
      {
        team: { displayName: 'Buffalo Bills' },
        statistics: [
          {
            name: 'rushing',
            keys: ['rushingAttempts', 'rushingYards', 'rushingTouchdowns'],
            athletes: [
              {
                athlete: { id: '1', displayName: 'James Cook', position: { abbreviation: 'RB' } },
                stats: ['18', '84', '1'],
              },
            ],
          },
          {
            name: 'receiving',
            keys: ['receptions', 'receivingYards'],
            athletes: [
              {
                athlete: { id: '1', displayName: 'James Cook', position: { abbreviation: 'RB' } },
                stats: ['3', '22'],
              },
            ],
          },
        ],
      },
    ];

    const lines = parseBoxscorePlayers(teams);
    expect(lines).toHaveLength(1);
    const cook = lines[0]!;
    expect(cook).toMatchObject({
      externalId: '1',
      name: 'James Cook',
      team: 'Buffalo Bills',
      position: 'RB',
    });
    expect(cook.stats).toEqual({
      rushingAttempts: 18,
      rushingYards: 84,
      rushingTouchdowns: 1,
      receptions: 3,
      receivingYards: 22,
    });
  });

  it('splits combined keys (made-attempted) into separate numeric stats', () => {
    const teams = [
      {
        team: { displayName: 'Boston Celtics' },
        statistics: [
          {
            name: 'starters',
            keys: [
              'minutes',
              'fieldGoalsMade-fieldGoalsAttempted',
              'threePointFieldGoalsMade-threePointFieldGoalsAttempted',
              'points',
            ],
            athletes: [
              {
                athlete: { id: '42', displayName: 'Jayson Tatum', position: { abbreviation: 'SF' } },
                stats: ['36:12', '9-19', '4-11', '28'],
              },
            ],
          },
        ],
      },
    ];

    const lines = parseBoxscorePlayers(teams);
    const tatum = lines[0]!;
    expect(tatum.stats).toEqual({
      fieldGoalsMade: 9,
      fieldGoalsAttempted: 19,
      threePointFieldGoalsMade: 4,
      threePointFieldGoalsAttempted: 11,
      points: 28,
    });
    // "36:12" is non-numeric → dropped
    expect(tatum.stats.minutes).toBeUndefined();
  });

  it('skips athletes without an id and tolerates empty input', () => {
    expect(parseBoxscorePlayers([])).toEqual([]);
    const teams = [
      {
        team: { displayName: 'X' },
        statistics: [
          { name: 'c', keys: ['points'], athletes: [{ athlete: {}, stats: ['10'] }] },
        ],
      },
    ];
    expect(parseBoxscorePlayers(teams)).toEqual([]);
  });
});

describe('parseSummary', () => {
  const data = {
    header: {
      competitions: [
        {
          status: { period: 7, type: { name: 'STATUS_IN_PROGRESS', shortDetail: 'Top 7th' } },
          competitors: [
            { homeAway: 'home', score: '1', linescores: [{ value: 0 }, { value: 1 }, { value: 0 }] },
            { homeAway: 'away', score: '7', linescores: [{ value: 3 }, { value: 0 }, { value: 4 }] },
          ],
        },
      ],
    },
    boxscore: { players: [] },
  };

  it('extracts live game state incl. linescores and period', () => {
    const { game } = parseSummary(data);
    expect(game.status).toBe('LIVE');
    expect(game.homeScore).toBe(1);
    expect(game.awayScore).toBe(7);
    expect(game.period).toBe(7);
    expect(game.displayClock).toBe('Top 7th');
    expect(game.homeLinescores).toEqual([0, 1, 0]);
    expect(game.awayLinescores).toEqual([3, 0, 4]);
  });

  it('maps a final status and tolerates a missing box score', () => {
    const final = {
      header: {
        competitions: [
          {
            status: { period: 9, type: { name: 'STATUS_FINAL' } },
            competitors: [
              { homeAway: 'home', score: '5' },
              { homeAway: 'away', score: '2' },
            ],
          },
        ],
      },
    };
    const { game, players } = parseSummary(final);
    expect(game.status).toBe('FINAL');
    expect(game.homeScore).toBe(5);
    expect(game.homeLinescores).toBeUndefined();
    expect(players).toEqual([]);
  });

  it('returns undefined status for an unparseable payload', () => {
    expect(parseSummary({}).game.status).toBeUndefined();
  });
});
