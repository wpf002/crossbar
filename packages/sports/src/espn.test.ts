import { describe, it, expect } from 'vitest';
import { parseBoxscorePlayers } from './espn.js';

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
